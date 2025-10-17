use riterm_shared::p2p::{P2PNetwork, NodeTicket, MessageDomain, MessageBuilder, StructuredPayload, SessionMessage};
use iroh_base::ticket::Ticket;
use anyhow::Result;
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::init();

    // Get the session ticket from environment or command line argument
    let ticket_str = std::env::var("SESSIONTICKET")
        .map_err(|_| anyhow::anyhow!("No session ticket provided"))?;

    println!("🔧 Testing P2P connection with Node ID architecture...");

    // Parse the ticket
    let ticket = NodeTicket::deserialize(&ticket_str)?;
    let host_node_id = ticket.node_addr().node_id;

    println!("📡 Host Node ID: {}", host_node_id);

    // Initialize P2P network
    println!("🚀 Initializing P2P network...");
    let network = P2PNetwork::new(None).await?;

    // Get our node ID
    let our_node_id = network.get_node_id();
    println!("🔗 Our Node ID: {}", our_node_id);

    println!("✅ P2P network initialized");

    // Join the session using the new Node ID approach
    println!("🔗 Joining session with host: {}", host_node_id);
    match network.join_session(ticket).await {
        Ok((_connection_sender, _event_receiver)) => {
            println!("✅ Successfully joined session!");

            // Wait a bit for connection to stabilize
            sleep(Duration::from_secs(2)).await;

            // Test sending a message to the host
            println!("📤 Sending test message to host...");
            let test_message = MessageBuilder::new()
                .from_node(our_node_id)
                .with_domain(MessageDomain::Session)
                .build(StructuredPayload::Session(SessionMessage::DirectedMessage {
                    to: host_node_id,
                    data: "ping".to_string(),
                }));

            match network.send_message(host_node_id, test_message).await {
                Ok(_) => {
                    println!("✅ Message sent successfully!");
                }
                Err(e) => {
                    println!("❌ Failed to send message: {}", e);
                }
            }

            // Check active connections
            let active_nodes = network.get_active_node_ids().await;
            println!("🔍 Active connections: {:?}", active_nodes);

            // Wait to receive any messages
            println!("⏳ Waiting for messages... (Ctrl+C to exit)");
            sleep(Duration::from_secs(10)).await;

        }
        Err(e) => {
            println!("❌ Failed to join session: {}", e);
            return Err(e);
        }
    }

    println!("🏁 Test completed");
    Ok(())
}