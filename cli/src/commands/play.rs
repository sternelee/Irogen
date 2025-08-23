use anyhow::Result;

use crate::playback::SessionPlayer;

/// Handles the play command
pub struct PlayCommand;

impl PlayCommand {
    pub async fn execute(file: String) -> Result<()> {
        SessionPlayer::play_session(file).await
    }
}

