use anyhow::Result;
use futures::StreamExt;
use iroh::{protocol::Router, Endpoint, NodeAddr, NodeId};
use iroh_gossip::{
    api::{Event, GossipReceiver, GossipSender},
    net::Gossip,
    proto::TopicId,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, error, info, warn};

use crate::terminal::{SessionHeader, TerminalEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTicket {
    pub topic_id: TopicId,
    pub nodes: Vec<NodeAddr>,
}

impl std::fmt::Display for SessionTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let encoded = data_encoding::BASE32.encode(&serde_json::to_vec(self).unwrap());
        write!(f, "{}", encoded)
    }
}

impl std::str::FromStr for SessionTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = data_encoding::BASE32.decode(s.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode ticket: {}", e))?;
        let ticket: SessionTicket = serde_json::from_slice(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize ticket: {}", e))?;
        Ok(ticket)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalMessage {
    pub body: TerminalMessageBody,
    pub nonce: [u8; 16],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalMessageBody {
    /// Session metadata
    SessionInfo {
        from: NodeId,
        header: SessionHeader,
    },
    /// Terminal output data
    Output {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// User input data
    Input {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// Resize event
    Resize {
        from: NodeId,
        width: u16,
        height: u16,
        timestamp: u64,
    },
    /// Session ended
    SessionEnd {
        from: NodeId,
        timestamp: u64,
    },
}

impl TerminalMessage {
    pub fn new(body: TerminalMessageBody) -> Self {
        Self {
            body,
            nonce: rand::random(),
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        serde_json::from_slice(bytes).map_err(Into::into)
    }

    pub fn to_vec(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("serde_json::to_vec is infallible")
    }
}

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
}

pub struct P2PNetwork {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    sessions: RwLock<HashMap<String, SharedSession>>,
}

impl Clone for P2PNetwork {
    fn clone(&self) -> Self {
        Self {
            endpoint: self.endpoint.clone(),
            gossip: self.gossip.clone(),
            router: self.router.clone(),
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

impl P2PNetwork {
    pub async fn new() -> Result<Self> {
        info!("Initializing iroh P2P network with gossip...");

        // Create iroh endpoint
        let endpoint = Endpoint::builder()
            .discovery_n0()
            .bind()
            .await?;

        let node_id = endpoint.node_id();
        info!("Node ID: {}", node_id);

        // Create gossip instance
        let gossip = Gossip::builder().spawn(endpoint.clone());

        // Create router with gossip protocol
        let router = Router::builder(endpoint.clone())
            .accept(iroh_gossip::ALPN, gossip.clone())
            .spawn();

        let network = Self {
            endpoint,
            gossip,
            router,
            sessions: RwLock::new(HashMap::new()),
        };

        Ok(network)
    }

    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<(TopicId, GossipSender, mpsc::UnboundedReceiver<String>)> {
        let session_id = header.session_id.clone();
        info!("Creating shared session: {}", session_id);

        // Create topic for this session using random bytes
        let topic_id = TopicId::from_bytes(rand::random());

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (_input_sender, input_receiver) = mpsc::unbounded_channel();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.endpoint.node_id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Subscribe to the gossip topic (empty node_ids means we're creating a new topic)
        let topic = self.gossip.subscribe(topic_id, vec![]).await?;
        let (sender, receiver) = topic.split();

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        // Send session info message
        let message = TerminalMessage::new(TerminalMessageBody::SessionInfo {
            from: self.endpoint.node_id(),
            header,
        });
        sender.broadcast(message.to_vec().into()).await?;

        Ok((topic_id, sender, input_receiver))
    }

    pub async fn join_session(
        &self,
        topic_id: TopicId,
        peers: Vec<NodeAddr>,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        info!("Joining session with topic: {}", topic_id);

        let session_id = format!("session_{}", topic_id);
        let (event_sender, event_receiver) = broadcast::channel(1000);

        // Create session entry for this joined session
        let session = SharedSession {
            header: SessionHeader {
                version: 2,
                width: 80,
                height: 24,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_secs(),
                title: None,
                command: None,
                session_id: session_id.clone(),
            },
            participants: vec![],
            is_host: false,
            event_sender: event_sender.clone(),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Add peer addresses to endpoint's addressbook
        for peer in &peers {
            self.endpoint.add_node_addr(peer.clone())?;
        }

        // Subscribe and join the gossip topic with known peers
        let node_ids = peers.iter().map(|p| p.node_id).collect();
        let topic = self.gossip.subscribe_and_join(topic_id, node_ids).await?;
        let (sender, receiver) = topic.split();

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        Ok((sender, event_receiver))
    }

    pub async fn send_terminal_output(
        &self,
        sender: &GossipSender,
        data: String,
    ) -> Result<()> {
        debug!("Sending terminal output");

        let message = TerminalMessage::new(TerminalMessageBody::Output {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        });

        sender.broadcast(message.to_vec().into()).await?;
        Ok(())
    }

    pub async fn send_input(&self, sender: &GossipSender, data: String) -> Result<()> {
        debug!("Sending input data");

        let message = TerminalMessage::new(TerminalMessageBody::Input {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        });

        sender.broadcast(message.to_vec().into()).await?;
        Ok(())
    }

    pub async fn send_resize_event(&self, sender: &GossipSender, width: u16, height: u16) -> Result<()> {
        debug!("Sending resize event");

        let message = TerminalMessage::new(TerminalMessageBody::Resize {
            from: self.endpoint.node_id(),
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        });

        sender.broadcast(message.to_vec().into()).await?;
        Ok(())
    }

    pub async fn end_session(&self, sender: &GossipSender, session_id: String) -> Result<()> {
        info!("Ending session: {}", session_id);

        let message = TerminalMessage::new(TerminalMessageBody::SessionEnd {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        });

        sender.broadcast(message.to_vec().into()).await?;
        self.sessions.write().await.remove(&session_id);
        Ok(())
    }

    async fn start_topic_listener(&self, mut receiver: GossipReceiver, session_id: String) -> Result<()> {
        // Create a new Arc with a copy of the current sessions
        let sessions = {
            let current_sessions = self.sessions.read().await;
            let mut new_sessions = HashMap::new();
            for (k, v) in current_sessions.iter() {
                new_sessions.insert(k.clone(), SharedSession {
                    header: v.header.clone(),
                    participants: v.participants.clone(),
                    is_host: v.is_host,
                    event_sender: v.event_sender.clone(),
                });
            }
            Arc::new(RwLock::new(new_sessions))
        };

        tokio::spawn(async move {
            while let Some(event) = receiver.next().await {
                if let Ok(Event::Received(msg)) = event {
                    if let Ok(message) = TerminalMessage::from_bytes(&msg.content) {
                        if let Err(e) = Self::handle_gossip_message(&sessions, &session_id, message).await {
                            error!("Failed to handle gossip message: {}", e);
                        }
                    }
                }
            }
        });

        Ok(())
    }

    async fn handle_gossip_message(
        sessions: &Arc<RwLock<HashMap<String, SharedSession>>>,
        session_id: &str,
        message: TerminalMessage,
    ) -> Result<()> {
        let sessions_guard = sessions.read().await;
        if let Some(session) = sessions_guard.get(session_id) {
            match message.body {
                TerminalMessageBody::Output { from: _, data, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Output,
                        data,
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send output event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::Input { from: _, data, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Input,
                        data,
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send input event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::Resize { from: _, width, height, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Resize { width, height },
                        data: format!("{}x{}", width, height),
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send resize event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::End,
                        data: "Session ended".to_string(),
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send end event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::SessionInfo { from, header: _ } => {
                    info!("Received session info from {} for session: {}", from.fmt_short(), session_id);
                }
            }
        }
        Ok(())
    }



    pub async fn get_node_id(&self) -> String {
        self.endpoint.node_id().to_string()
    }

    pub async fn get_node_addr(&self) -> Result<NodeAddr> {
        // Wait a bit for the network to initialize
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

        let node_id = self.endpoint.node_id();
        let mut node_addr = NodeAddr::new(node_id);

        // Add a placeholder direct address (localhost for testing)
        // In production, this should be the actual public IP/port
        let placeholder_addr = "127.0.0.1:11204".parse::<std::net::SocketAddr>()
            .map_err(|e| anyhow::anyhow!("Failed to parse placeholder address: {}", e))?;
        node_addr = node_addr.with_direct_addresses([placeholder_addr]);

        info!("Generated node address: {:?}", node_addr);
        Ok(node_addr)
    }

    pub async fn connect_to_peer(&self, node_addr: NodeAddr) -> Result<()> {
        info!("Connecting to peer: {}", node_addr.node_id);

        // Add the peer to our endpoint
        self.endpoint.add_node_addr(node_addr.clone())?;
        info!("Successfully added peer {} to endpoint", node_addr.node_id);

        Ok(())
    }

    pub async fn create_session_ticket(&self, topic_id: TopicId) -> Result<SessionTicket> {
        // Get the actual node address with network information
        let me = self.get_node_addr().await?;
        let nodes = vec![me];
        Ok(SessionTicket { topic_id, nodes })
    }

    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(Into::into)
    }

    pub async fn get_active_sessions(&self) -> Vec<String> {
        self.sessions.read().await.keys().cloned().collect()
    }

    pub async fn is_session_host(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.read().await.get(session_id) {
            session.is_host
        } else {
            false
        }
    }
}
