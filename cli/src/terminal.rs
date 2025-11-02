// Terminal recording and session management module
// Currently unused in agent mode but kept for future compatibility

/// Filter out unwanted terminal output strings
fn filter_terminal_output(data: &str) -> String {
    // Remove "1;2c" string from terminal output
    data.replace("1;2c", "")
}

/// Terminal raw mode RAII wrapper
struct RawModeGuard;

impl RawModeGuard {
    fn new() -> anyhow::Result<()> {
        crossterm::terminal::enable_raw_mode()?;
        Ok(())
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = crossterm::terminal::disable_raw_mode();
    }
}

/// PTY resources RAII wrapper
pub struct PtyResources {
    pub reader: Box<dyn std::io::Read + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub _pty_pair: portable_pty::PtyPair,
}

impl PtyResources {
    pub fn new(
        shell_config: &crate::shell::ShellConfig,
        width: u16,
        height: u16,
        session_id: &str,
    ) -> anyhow::Result<(Self, Box<dyn portable_pty::Child + Send + Sync>)> {
        let pty_system = portable_pty::native_pty_system();
        let pty_size = portable_pty::PtySize {
            rows: height,
            cols: width,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_pair = pty_system.openpty(pty_size)?;

        let command = shell_config.shell_type.get_command_path();
        let mut cmd = portable_pty::CommandBuilder::new(command);

        cmd.env("RITERM_SESSION_ID", session_id);

        let child = pty_pair.slave.spawn_command(cmd)?;

        let reader = pty_pair.master.try_clone_reader()?;
        let writer = pty_pair.master.take_writer()?;

        let resources = Self {
            reader,
            writer,
            _pty_pair: pty_pair,
        };

        Ok((resources, child))
    }
}
