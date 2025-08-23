use anyhow::{Context, Result};
use tokio::io::AsyncReadExt;
use tracing::info;

use crate::terminal::{TerminalEvent, TerminalPlayer};

pub struct PlaybackSession;

impl PlaybackSession {
    pub async fn start(file: String, speed: f32) -> Result<()> {
        println!("🎬 Playing back session from: {} (speed: {}x)", file, speed);

        let file_content = tokio::fs::read_to_string(&file)
            .await
            .with_context(|| format!("Failed to read session file: {}", file))?;

        let events: Vec<TerminalEvent> = serde_json::from_str(&file_content)
            .with_context(|| format!("Failed to parse session file: {}", file))?;

        if events.is_empty() {
            println!("⚠️  No events found in session file");
            return Ok(());
        }

        Self::validate_events(&events)?;

        println!(
            "📺 Starting playback of {} events. Press Ctrl+C to stop.",
            events.len()
        );
        println!("⏯️  Press any key to start...");

        // Wait for user input to start
        let _ = tokio::io::stdin().read_u8().await;

        let mut player = TerminalPlayer::new(events, speed);
        player.play().await?;

        println!("\n✅ Playback completed.");
        Ok(())
    }

    fn validate_events(events: &[TerminalEvent]) -> Result<()> {
        // Basic validation
        if events.is_empty() {
            return Err(anyhow::anyhow!("No events to play"));
        }

        // Check for reasonable timestamp ordering
        let mut last_timestamp = 0.0;
        for (i, event) in events.iter().enumerate() {
            if event.timestamp < last_timestamp {
                info!(
                    "Warning: Event {} has timestamp {} which is before previous event timestamp {}",
                    i, event.timestamp, last_timestamp
                );
            }
            last_timestamp = event.timestamp;
        }

        info!(
            "Session validation complete: {} events, duration: {:.2}s",
            events.len(),
            last_timestamp
        );

        Ok(())
    }

    pub fn get_session_info(file: &str) -> Result<SessionInfo> {
        let file_content = std::fs::read_to_string(file)
            .with_context(|| format!("Failed to read session file: {}", file))?;

        let events: Vec<TerminalEvent> = serde_json::from_str(&file_content)
            .with_context(|| format!("Failed to parse session file: {}", file))?;

        if events.is_empty() {
            return Ok(SessionInfo::default());
        }

        let duration = events.last().map(|e| e.timestamp).unwrap_or(0.0);
        let output_events = events
            .iter()
            .filter(|e| matches!(e.event_type, crate::terminal::EventType::Output))
            .count();
        let input_events = events
            .iter()
            .filter(|e| matches!(e.event_type, crate::terminal::EventType::Input))
            .count();

        Ok(SessionInfo {
            total_events: events.len(),
            duration,
            output_events,
            input_events,
        })
    }
}

#[derive(Debug)]
pub struct SessionInfo {
    pub total_events: usize,
    pub duration: f64,
    pub output_events: usize,
    pub input_events: usize,
}

impl Default for SessionInfo {
    fn default() -> Self {
        Self {
            total_events: 0,
            duration: 0.0,
            output_events: 0,
            input_events: 0,
        }
    }
}

impl std::fmt::Display for SessionInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Session Info: {} events, {:.2}s duration, {} output, {} input",
            self.total_events, self.duration, self.output_events, self.input_events
        )
    }
}

