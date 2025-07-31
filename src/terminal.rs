use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: f64,
    pub event_type: EventType,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventType {
    Output,
    Input,
    Resize { width: u16, height: u16 },
    Start,
    End,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHeader {
    pub version: u8,
    pub width: u16,
    pub height: u16,
    pub timestamp: u64,
    pub title: Option<String>,
    pub command: Option<String>,
    pub session_id: String,
}

pub struct TerminalRecorder {
    session_id: String,
    start_time: SystemTime,
    event_sender: mpsc::UnboundedSender<TerminalEvent>,
    events: std::sync::Arc<std::sync::Mutex<Vec<TerminalEvent>>>,
}

impl TerminalRecorder {
    pub fn new(session_id: String) -> (Self, mpsc::UnboundedReceiver<TerminalEvent>) {
        let (event_sender, event_receiver) = mpsc::unbounded_channel();
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorder = Self {
            session_id,
            start_time: SystemTime::now(),
            event_sender,
            events,
        };
        (recorder, event_receiver)
    }

    pub fn get_session_id(&self) -> &str {
        &self.session_id
    }

    fn get_relative_timestamp(&self) -> f64 {
        self.start_time.elapsed().unwrap_or_default().as_secs_f64()
    }

    pub fn record_output(&self, data: &[u8]) -> Result<()> {
        let data_str = String::from_utf8_lossy(data).to_string();
        let event = TerminalEvent {
            timestamp: self.get_relative_timestamp(),
            event_type: EventType::Output,
            data: data_str,
        };

        if let Ok(mut events) = self.events.lock() {
            events.push(event.clone());
        }

        self.event_sender
            .send(event)
            .context("Failed to send output event")?;
        Ok(())
    }

    pub fn record_input(&self, data: &[u8]) -> Result<()> {
        let data_str = String::from_utf8_lossy(data).to_string();
        let event = TerminalEvent {
            timestamp: self.get_relative_timestamp(),
            event_type: EventType::Input,
            data: data_str,
        };

        if let Ok(mut events) = self.events.lock() {
            events.push(event.clone());
        }

        self.event_sender
            .send(event)
            .context("Failed to send input event")?;
        Ok(())
    }

    pub fn record_resize(&self, width: u16, height: u16) -> Result<()> {
        let event = TerminalEvent {
            timestamp: self.get_relative_timestamp(),
            event_type: EventType::Resize { width, height },
            data: String::new(),
        };

        if let Ok(mut events) = self.events.lock() {
            events.push(event.clone());
        }

        self.event_sender
            .send(event)
            .context("Failed to send resize event")?;
        Ok(())
    }

    pub fn handle_remote_input(&self, data: &str, writer: &mut dyn Write) -> Result<()> {
        writer
            .write_all(data.as_bytes())
            .context("Failed to write remote input to PTY")?;
        writer
            .flush()
            .context("Failed to flush remote input to PTY")?;

        self.record_input(data.as_bytes())?;
        Ok(())
    }

    pub async fn save_to_file(&self, file_path: &str) -> Result<()> {
        let events = self
            .events
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock events"))?
            .clone();

        let json_data =
            serde_json::to_string_pretty(&events).context("Failed to serialize events to JSON")?;

        tokio::fs::write(file_path, json_data)
            .await
            .with_context(|| format!("Failed to write session to file: {}", file_path))?;

        info!("Session saved to file: {}", file_path);
        Ok(())
    }

    pub fn start_session(&self, command: &str, width: u16, height: u16) -> Result<()> {
        info!("Starting terminal session: {}", command);

        let pty_system = native_pty_system();
        let pty_size = PtySize {
            rows: height,
            cols: width,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_pair = pty_system.openpty(pty_size).context("Failed to open PTY")?;

        let mut cmd = CommandBuilder::new(command);
        cmd.env("TERM", "xterm-256color");

        let mut child = pty_pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command")?;

        let mut reader = pty_pair.master.try_clone_reader()?;
        let mut writer = pty_pair.master.take_writer()?;

        let event_sender = self.event_sender.clone();
        let start_event = TerminalEvent {
            timestamp: 0.0,
            event_type: EventType::Start,
            data: command.to_string(),
        };
        event_sender.send(start_event)?;

        tokio::spawn(async move {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        debug!("PTY reader reached EOF");
                        break;
                    }
                    Ok(n) => {
                        let data = &buffer[..n];
                        if let Err(e) = std::io::stdout().write_all(data) {
                            error!("Failed to write to stdout: {}", e);
                            break;
                        }
                        std::io::stdout().flush().ok();

                        let output_event = TerminalEvent {
                            timestamp: SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs_f64(),
                            event_type: EventType::Output,
                            data: String::from_utf8_lossy(data).to_string(),
                        };

                        if event_sender.send(output_event).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Failed to read from PTY: {}", e);
                        break;
                    }
                }
            }

            let end_event = TerminalEvent {
                timestamp: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64(),
                event_type: EventType::End,
                data: String::new(),
            };
            event_sender.send(end_event).ok();
        });

        tokio::spawn(async move {
            let mut stdin = tokio::io::stdin();
            let mut buffer = [0u8; 1024];

            loop {
                match stdin.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &buffer[..n];
                        if let Err(e) = writer.write(data) {
                            error!("Failed to write to PTY: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Failed to read from stdin: {}", e);
                        break;
                    }
                }
            }
        });

        tokio::spawn(async move {
            if let Ok(status) = child.wait() {
                info!("Child process exited with status: {:?}", status);
            }
        });

        Ok(())
    }
}

pub struct TerminalPlayer {
    events: Vec<TerminalEvent>,
    current_index: usize,
}

impl TerminalPlayer {
    pub fn new(events: Vec<TerminalEvent>) -> Self {
        Self {
            events,
            current_index: 0,
        }
    }

    pub async fn play(&mut self) -> Result<()> {
        info!("Starting playback of {} events", self.events.len());

        let mut last_timestamp = 0.0;

        for event in &self.events {
            let delay = event.timestamp - last_timestamp;
            if delay > 0.0 {
                tokio::time::sleep(tokio::time::Duration::from_secs_f64(delay)).await;
            }

            match &event.event_type {
                EventType::Output => {
                    print!("{}", event.data);
                    std::io::stdout().flush().ok();
                }
                EventType::Start => {
                    info!("Session started with command: {}", event.data);
                }
                EventType::End => {
                    info!("Session ended");
                }
                EventType::Resize { width, height } => {
                    debug!("Terminal resized to {}x{}", width, height);
                }
                EventType::Input => {}
            }

            last_timestamp = event.timestamp;
        }

        Ok(())
    }
}

