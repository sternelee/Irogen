use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Mobile app configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobileConfig {
    pub network: NetworkConfig,
    pub ui: UiConfig,
    pub session: SessionConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub default_relay: Option<String>,
    pub connection_timeout_ms: u64,
    pub retry_attempts: u32,
    pub heartbeat_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: String,
    pub font_size: u16,
    pub auto_scroll: bool,
    pub show_timestamps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub auto_reconnect: bool,
    pub max_history_lines: usize,
    pub buffer_size: usize,
}

impl Default for MobileConfig {
    fn default() -> Self {
        Self {
            network: NetworkConfig {
                default_relay: None,
                connection_timeout_ms: 30000,
                retry_attempts: 3,
                heartbeat_interval_ms: 10000,
            },
            ui: UiConfig {
                theme: "dark".to_string(),
                font_size: 14,
                auto_scroll: true,
                show_timestamps: false,
            },
            session: SessionConfig {
                auto_reconnect: true,
                max_history_lines: 1000,
                buffer_size: 1024,
            },
        }
    }
}

impl MobileConfig {
    pub fn load() -> Self {
        // In a real implementation, this would load from a config file
        // For now, return defaults
        Self::default()
    }

    pub fn connection_timeout(&self) -> Duration {
        Duration::from_millis(self.network.connection_timeout_ms)
    }

    pub fn heartbeat_interval(&self) -> Duration {
        Duration::from_millis(self.network.heartbeat_interval_ms)
    }
}

