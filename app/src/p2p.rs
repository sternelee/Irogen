use anyhow::Result;
use riterm_shared::{P2PNetwork, SessionTicket};
use tokio::sync::broadcast;
use iroh_gossip::api::GossipSender;
use iroh::NodeAddr;

// Re-export methods that were used in app
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
    topic_id: iroh_gossip::proto::TopicId,
    session_id: &str,
) -> Result<SessionTicket> {
    network.create_session_ticket(topic_id, session_id).await
}

pub async fn join_session(
    network: &P2PNetwork,
    ticket: SessionTicket,
) -> Result<(GossipSender, broadcast::Receiver<riterm_shared::TerminalEvent>)> {
    network.join_session(ticket).await
}