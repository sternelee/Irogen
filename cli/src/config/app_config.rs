use std::time::Duration;

/// Application-wide configuration
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub default_width: u16,
    pub default_height: u16,
    pub max_retry_attempts: u32,
    pub retry_delay: Duration,
    pub log_buffer_size: usize,
    pub channel_buffer_size: usize,
    pub history_wait_timeout: Duration,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            default_width: 80,
            default_height: 24,
            max_retry_attempts: 3,
            retry_delay: Duration::from_secs(2),
            log_buffer_size: 1024 * 1024, // 1MB
            channel_buffer_size: 1000,
            history_wait_timeout: Duration::from_millis(500),
        }
    }
}

impl AppConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_terminal_size(mut self, width: u16, height: u16) -> Self {
        self.default_width = width;
        self.default_height = height;
        self
    }

    pub fn with_retry_config(mut self, attempts: u32, delay: Duration) -> Self {
        self.max_retry_attempts = attempts;
        self.retry_delay = delay;
        self
    }

    pub fn with_buffer_sizes(mut self, log_size: usize, channel_size: usize) -> Self {
        self.log_buffer_size = log_size;
        self.channel_buffer_size = channel_size;
        self
    }
}

