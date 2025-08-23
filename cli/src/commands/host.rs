use anyhow::Result;

use crate::session::{HostSession, SessionManager};
use crate::ui::{DisplayManager, QrCodeGenerator, ShellListDisplay};

/// Handles the host command
pub struct HostCommand;

impl HostCommand {
    pub async fn execute(
        session_manager: SessionManager,
        shell: Option<String>,
        title: Option<String>,
        width: u16,
        height: u16,
        save: Option<String>,
        passthrough: bool,
        list_shells: bool,
    ) -> Result<()> {
        if list_shells {
            ShellListDisplay::display_available_shells();
            return Ok(());
        }

        let mut host_session = HostSession::new(session_manager);

        // Display session info before starting
        if let Ok((shell_config, header)) =
            SessionManager::create_session_header(shell.clone(), title.clone(), width, height).await
        {
            DisplayManager::print_session_info(
                &header.session_id,
                shell_config.shell_type.get_display_name(),
                &shell_config.get_full_command().0,
                width,
                height,
            );
        }

        host_session
            .start(shell, title, width, height, save, passthrough)
            .await
    }

    pub fn display_session_ticket(ticket: &str) {
        DisplayManager::print_join_info(ticket);
        QrCodeGenerator::display_qr_code(ticket);
    }
}

