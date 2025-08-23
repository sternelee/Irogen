use crate::p2p::P2PNetwork;
use crate::terminal_events::TerminalEvent;
use iroh_gossip::api::GossipSender;
use std::collections::HashMap;
use tokio::sync::{Mutex, broadcast};

/// Application state management
#[derive(Default)]
pub struct AppState {
    pub network: Mutex<Option<P2PNetwork>>,
    pub sessions: Mutex<HashMap<String, SessionInfo>>,
}

/// Information about an active session
pub struct SessionInfo {
    pub session_id: String,
    pub sender: Option<GossipSender>,
    pub receiver: Option<broadcast::Receiver<TerminalEvent>>,
    pub is_host: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            network: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn cleanup(&self) {
        // Clean up network
        if let Some(network) = self.network.lock().await.take() {
            let _ = network.shutdown().await;
        }

        // Clean up sessions
        self.sessions.lock().await.clear();
    }
}

