use anyhow::Result;
use riterm_shared::{P2PNetwork, SessionTicket, SessionHeader, SessionInfo};
use tokio::sync::mpsc;
use iroh_gossip::api::GossipSender;
use iroh_gossip::proto::TopicId;
use iroh::NodeAddr;

// Re-export the new method with the same signature as the old one
pub async fn create_shared_session(
    network: &P2PNetwork,
    header: SessionHeader,
) -> Result<(TopicId, GossipSender, mpsc::UnboundedReceiver<String>)> {
    // Call the shared implementation
    network.create_shared_session(header).await
}

// Re-export other methods that were used in cli
pub async fn send_terminal_output(
    network: &P2PNetwork,
    sender: &GossipSender,
    data: String,
    session_id: &str,
) -> Result<()> {
    network.send_terminal_output(session_id, sender, data).await
}

pub async fn send_input(
    network: &P2PNetwork,
    sender: &GossipSender,
    data: String,
    session_id: &str,
) -> Result<()> {
    network.send_input(session_id, sender, data).await
}

pub async fn send_resize_event(
    network: &P2PNetwork,
    sender: &GossipSender,
    width: u16,
    height: u16,
    session_id: &str,
) -> Result<()> {
    network.send_resize_event(session_id, sender, width, height).await
}

pub async fn send_history_data(
    network: &P2PNetwork,
    sender: &GossipSender,
    session_info: SessionInfo,
    session_id: &str,
) -> Result<()> {
    network.send_history_data(
        session_id,
        sender,
        session_info.shell,
        session_info.cwd,
        session_info.logs.lines().map(|s| s.to_string()).collect()
    ).await
}

pub async fn end_session(network: &P2PNetwork, sender: &GossipSender, session_id: String) -> Result<()> {
    network.end_session(&session_id, sender).await
}

pub async fn get_node_id(network: &P2PNetwork) -> String {
    network.get_node_id().await
}

pub async fn get_node_addr(network: &P2PNetwork) -> Result<NodeAddr> {
    network.get_node_addr().await
}

pub async fn connect_to_peer(network: &P2PNetwork, node_addr: NodeAddr) -> Result<()> {
    network.connect_to_peer(node_addr).await
}

pub async fn create_session_ticket(
    network: &P2PNetwork,
    topic_id: TopicId,
    session_id: &str,
) -> Result<SessionTicket> {
    network.create_session_ticket(topic_id, session_id).await
}

pub async fn set_history_callback<F>(network: &P2PNetwork, callback: F)
where
    F: Fn(&str) -> tokio::sync::oneshot::Receiver<Option<SessionInfo>> + Send + Sync + 'static,
{
    network.set_history_callback(callback).await
}