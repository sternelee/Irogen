use std::time::Duration;

/// Network-specific configuration
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub relay_url: Option<String>,
    pub connection_timeout: Duration,
    pub heartbeat_interval: Duration,
    pub max_message_size: usize,
    pub gossip_buffer_size: usize,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            relay_url: None,
            connection_timeout: Duration::from_secs(30),
            heartbeat_interval: Duration::from_secs(10),
            max_message_size: 1024 * 1024, // 1MB
            gossip_buffer_size: 1000,
        }
    }
}

impl NetworkConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_relay(mut self, relay_url: String) -> Self {
        self.relay_url = Some(relay_url);
        self
    }

    pub fn with_timeouts(mut self, connection: Duration, heartbeat: Duration) -> Self {
        self.connection_timeout = connection;
        self.heartbeat_interval = heartbeat;
        self
    }

    pub fn with_message_limits(mut self, max_size: usize, buffer_size: usize) -> Self {
        self.max_message_size = max_size;
        self.gossip_buffer_size = buffer_size;
        self
    }
}