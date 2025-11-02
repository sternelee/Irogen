//! Terminal runner implementation inspired by sshx
//! Handles a single terminal session with efficient data processing

use anyhow::{Context, Result};
use encoding_rs::{CoderResult, UTF_8};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tracing::{error, info};

// Legacy types from removed p2p module - recreated for compatibility
#[derive(Debug, Clone, PartialEq)]
pub enum TerminalStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone)]
pub struct TerminalInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub status: TerminalStatus,
    pub created_at: u64,
    pub last_activity: u64,
    pub size: (u16, u16),
    pub process_id: Option<u32>,
}

use crate::terminal_driver::Terminal;

const CONTENT_CHUNK_SIZE: usize = 1 << 16; // 64KB
const CONTENT_ROLLING_BYTES: usize = 8 << 20; // 8MB
const CONTENT_PRUNE_BYTES: usize = 12 << 20; // 12MB
const BUFFER_SIZE: usize = 4096;

/// Commands that can be sent to a terminal
#[derive(Debug)]
pub enum TerminalCommand {
    Input(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Internal message for terminal runner
#[derive(Debug)]
pub enum TerminalData {
    /// Sequence of input bytes
    Data(Vec<u8>),
    /// Information about current sequence number
    Sync(u64),
    /// Resize the terminal
    Size(u16, u16),
}

/// Efficient terminal runner inspired by sshx
pub struct TerminalRunner {
    id: String,
    terminal: Terminal,
    name: Option<String>,
    shell_type: String,
    current_dir: String,
    status: TerminalStatus,
    created_at: std::time::SystemTime,
    last_activity: std::time::SystemTime,
    size: (u16, u16),

    // Content management (inspired by sshx)
    content: String,
    content_offset: usize,
    sequence: u64,
    decoder: encoding_rs::Decoder,

    // Callback for output
    output_callback: Option<Box<dyn Fn(String, String) + Send + Sync>>,
}

impl TerminalRunner {
    /// Create a new terminal runner
    pub async fn new(
        id: String,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<Self> {
        let shell = match shell_path {
            Some(shell) => shell,
            None => {
                let default_shell = crate::terminal_driver::get_default_shell().await;
                info!("Detected system default shell: {}", default_shell);
                default_shell
            }
        };

        info!(
            "Creating terminal runner '{}' ({}) with shell: {}",
            id,
            name.as_deref().unwrap_or("unnamed"),
            shell
        );

        let mut terminal = Terminal::new(&shell)
            .await
            .context("Failed to create terminal")?;

        // Set terminal size
        let size = size.unwrap_or((24, 80));
        terminal
            .set_winsize(size.0, size.1)
            .context("Failed to set terminal size")?;

        // Get actual terminal size
        let actual_size = terminal.get_winsize().unwrap_or(size);

        let current_dir = working_dir.unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

        let shell_type = extract_shell_type(&shell);
        let now = std::time::SystemTime::now();

        Ok(Self {
            id,
            terminal,
            name,
            shell_type,
            current_dir,
            status: TerminalStatus::Running,
            created_at: now,
            last_activity: now,
            size: actual_size,
            content: String::new(),
            content_offset: 0,
            sequence: 0,
            decoder: UTF_8.new_decoder(),
            output_callback: None,
        })
    }

    /// Set output callback for terminal output
    pub fn set_output_callback<F>(&mut self, callback: F)
    where
        F: Fn(String, String) + Send + Sync + 'static,
    {
        self.output_callback = Some(Box::new(callback));
    }

    /// Run the terminal with command receiver
    pub async fn run(mut self, mut command_rx: mpsc::Receiver<TerminalCommand>) -> Result<()> {
        let mut buf = [0u8; BUFFER_SIZE];
        let mut finished = false;

        info!("Starting terminal runner: {}", self.id);

        while !finished {
            tokio::select! {
                result = self.terminal.read(&mut buf) => {
                    let n = result?;
                    if n == 0 {
                        info!("Terminal {} EOF reached", self.id);
                        finished = true;
                    } else {
                        self.process_output(&buf[..n]).await;
                    }
                    self.last_activity = std::time::SystemTime::now();
                }
                command = command_rx.recv() => {
                    match command {
                        Some(TerminalCommand::Input(data)) => {
                            if let Err(e) = self.handle_input(data).await {
                                error!("Failed to handle input for terminal {}: {}", self.id, e);
                            }
                        }
                        Some(TerminalCommand::Resize(rows, cols)) => {
                            if let Err(e) = self.handle_resize(rows, cols).await {
                                error!("Failed to resize terminal {}: {}", self.id, e);
                            }
                        }
                        Some(TerminalCommand::Close) => {
                            info!("Received close command for terminal {}", self.id);
                            finished = true;
                        }
                        None => {
                            info!("Command channel closed for terminal {}", self.id);
                            finished = true;
                        }
                    }
                }
            }
        }

        self.status = TerminalStatus::Stopped;
        info!("Terminal runner {} stopped", self.id);
        Ok(())
    }

    /// Process terminal output (inspired by sshx's shell_task)
    async fn process_output(&mut self, data: &[u8]) {
        // Reserve space for new content
        self.content
            .reserve(self.decoder.max_utf8_buffer_length(data.len()).unwrap());

        // Decode UTF-8 data
        let (result, _, _) = self
            .decoder
            .decode_to_string(data, &mut self.content, false);
        debug_assert!(result == CoderResult::InputEmpty);

        // Update sequence
        let total_content_len = (self.content_offset + self.content.len()) as u64;

        if total_content_len > self.sequence {
            let start_offset = (self.sequence - self.content_offset as u64) as usize;
            let start = self.prev_char_boundary(start_offset);
            let end = self.prev_char_boundary((start + CONTENT_CHUNK_SIZE).min(self.content.len()));

            if start < end {
                let output_data = &self.content[start..end];

                // Send output via callback if available
                if let Some(ref callback) = self.output_callback {
                    callback(self.id.clone(), output_data.to_string());
                }

                // Update sequence
                self.sequence = (self.content_offset + end) as u64;
            }
        }

        // Prune content if it gets too large (inspired by sshx)
        if self.content.len() > CONTENT_PRUNE_BYTES
            && self.sequence > CONTENT_ROLLING_BYTES as u64
            && self.sequence - CONTENT_ROLLING_BYTES as u64 > self.content_offset as u64
        {
            let pruned =
                (self.sequence - CONTENT_ROLLING_BYTES as u64) - self.content_offset as u64;
            let pruned = self.prev_char_boundary(pruned as usize);
            self.content_offset += pruned;
            self.content.drain(..pruned);
        }
    }

    /// Handle input data
    async fn handle_input(&mut self, data: Vec<u8>) -> Result<()> {
        self.terminal
            .write_all(&data)
            .await
            .context("Failed to write to terminal")?;
        self.terminal
            .flush()
            .await
            .context("Failed to flush terminal")?;
        Ok(())
    }

    /// Handle terminal resize
    async fn handle_resize(&mut self, rows: u16, cols: u16) -> Result<()> {
        self.terminal
            .set_winsize(rows, cols)
            .context("Failed to set terminal size")?;
        self.size = (rows, cols);
        self.last_activity = std::time::SystemTime::now();
        info!("Resized terminal {} to {}x{}", self.id, rows, cols);
        Ok(())
    }

    /// Get terminal info
    pub fn get_info(&self) -> TerminalInfo {
        TerminalInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            shell_type: self.shell_type.clone(),
            current_dir: self.current_dir.clone(),
            status: self.status.clone(),
            created_at: self
                .created_at
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            last_activity: self
                .last_activity
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            size: self.size,
            process_id: None,
        }
    }

    /// Find the last char boundary before an index (from sshx)
    fn prev_char_boundary(&self, i: usize) -> usize {
        (0..=i)
            .rev()
            .find(|&j| self.content.is_char_boundary(j))
            .expect("no previous char boundary")
    }

    /// Get current sequence number
    pub fn get_sequence(&self) -> u64 {
        self.sequence
    }

    /// Get terminal size
    pub fn get_size(&self) -> (u16, u16) {
        self.size
    }

    /// Get terminal status
    pub fn get_status(&self) -> &TerminalStatus {
        &self.status
    }
}

/// Extract shell type from shell path (similar to sshx)
fn extract_shell_type(shell_path: &str) -> String {
    if let Some(name) = std::path::Path::new(shell_path)
        .file_name()
        .and_then(|n| n.to_str())
    {
        name.to_lowercase()
    } else {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_type_extraction() {
        assert_eq!(extract_shell_type("/bin/bash"), "bash");
        assert_eq!(
            extract_shell_type("C:\\Windows\\System32\\cmd.exe"),
            "cmd.exe"
        );
        assert_eq!(extract_shell_type("zsh"), "zsh");
        assert_eq!(extract_shell_type("invalid"), "unknown");
    }

    #[test]
    fn test_prev_char_boundary() {
        let runner = TerminalRunner {
            id: "test".to_string(),
            terminal: unsafe { std::mem::zeroed() },
            name: None,
            shell_type: "bash".to_string(),
            current_dir: "/".to_string(),
            status: TerminalStatus::Running,
            created_at: std::time::SystemTime::now(),
            last_activity: std::time::SystemTime::now(),
            size: (24, 80),
            content: "hello world".to_string(),
            content_offset: 0,
            sequence: 0,
            decoder: UTF_8.new_decoder(),
            output_callback: None,
        };

        assert_eq!(runner.prev_char_boundary(5), 5); // 'o' in "hello"
        assert_eq!(runner.prev_char_boundary(11), 11); // end of string
        assert_eq!(runner.prev_char_boundary(0), 0); // start of string
    }
}
