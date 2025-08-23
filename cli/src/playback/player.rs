use anyhow::{Context, Result};
use tokio::io::AsyncReadExt;
use tracing::info;

use crate::terminal::{TerminalEvent, TerminalPlayer};
use crate::ui::DisplayManager;

/// Handles session playback functionality
pub struct SessionPlayer;

impl SessionPlayer {
    pub async fn play_session(file_path: String) -> Result<()> {
        info!("Playing back session from: {}", file_path);

        let file_content = tokio::fs::read_to_string(&file_path)
            .await
            .with_context(|| format!("Failed to read session file: {}", file_path))?;

        let events: Vec<TerminalEvent> = serde_json::from_str(&file_content)
            .with_context(|| format!("Failed to parse session file: {}", file_path))?;

        if events.is_empty() {
            DisplayManager::print_warning_message("No events found in session file");
            return Ok(());
        }

        DisplayManager::print_playback_info(events.len());

        // Wait for user input to start
        let _ = tokio::io::stdin().read_u8().await;

        let mut player = TerminalPlayer::new(events);
        player.play().await?;

        DisplayManager::print_success_message("Playback completed");
        Ok(())
    }
}