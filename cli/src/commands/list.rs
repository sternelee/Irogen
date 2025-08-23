use anyhow::Result;
use crossterm::{
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
};
use std::io;

use crate::session::SessionManager;
use crate::ui::DisplayManager;

/// Handles the list command
pub struct ListCommand;

impl ListCommand {
    pub async fn execute(session_manager: &SessionManager) -> Result<()> {
        println!("📋 Active Sessions:");

        let network = session_manager.network();
        DisplayManager::print_network_info(&network.get_node_id().await, None);
        println!();

        let sessions = session_manager.list_active_sessions().await;

        if sessions.is_empty() {
            DisplayManager::print_info_message("No active sessions found");
        } else {
            for (index, session_info) in sessions.iter().enumerate() {
                let role = if session_info.is_host {
                    "Host"
                } else {
                    "Participant"
                };

                execute!(
                    io::stdout(),
                    SetForegroundColor(Color::Cyan),
                    Print(format!("{}. ", index + 1)),
                    ResetColor,
                    Print(format!("{} ({})\n", session_info.session_id, role))
                )?;
            }

            // Display session stats
            let (total, hosted) = session_manager.get_session_stats().await;
            println!();
            println!("📊 Total sessions: {}, Hosted: {}", total, hosted);
        }

        Ok(())
    }
}

