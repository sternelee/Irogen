use anyhow::Result;

use crate::session::{ParticipantSession, SessionManager};
use crate::ui::DisplayManager;

/// Handles the join command
pub struct JoinCommand;

impl JoinCommand {
    pub async fn execute(session_manager: SessionManager, ticket: String) -> Result<()> {
        DisplayManager::print_info_message("Joining session with ticket...");

        let mut participant_session = ParticipantSession::new(session_manager);
        participant_session.join(ticket).await
    }
}

