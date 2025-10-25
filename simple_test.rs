use anyhow::{Context, Result};
use iroh::Endpoint;
use tokio::io::AsyncWriteExt;
use tracing::{info, warn, error};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    // The NodeTicket from the CLI host
    let node_ticket_str = "nodeaddrcdrz6eeajzwnvpzcuyjahkkiw4exmrdfq2lypbnxxwccwd2h6ajpnb2hi4dthixs6ylqomys2mjoojswyylzfzxdaltjojxwqlldmfxgc4tzfzuxe33ifzwgs3tlfyxqmaaksd3xplnpamahrzlertlfeagavaaqf6x6amambkag7cw26ayaycuiwa5nv4bqbqfi24ak3lyd";
    
    println!("Testing connection to CLI host...");
    
    // Parse the ticket - we need to extract the node address from it
    println!("Node Ticket: {}", node_ticket_str);
    
    // Create iroh endpoint - matching the CLI settings
    let endpoint = Endpoint::builder()
        .alpns(vec![
            b"DUMBPIPEV0".to_vec(),
            b"riterm".to_vec(),
        ])
        .discovery_n0()
        .bind()
        .await?;

    // Wait for endpoint to be ready
    endpoint.online().await;
    
    // Parse the node ticket manually to get the node address
    let ticket = node_ticket_str.parse::<riterm_shared::NodeTicket>()?;
    let node_addr = ticket.node_addr();
    
    println!("Attempting to connect to node: {}", node_addr.node_id);
    
    // Try to connect with DUMBPIPEV0 ALPN first
    let connection = match endpoint.connect(node_addr.clone(), b"DUMBPIPEV0").await {
        Ok(conn) => {
            info!("Connected with DUMBPIPEV0 ALPN");
            conn
        }
        Err(e1) => {
            warn!("Failed to connect with DUMBPIPEV0: {}", e1);
            // Try using riterm ALPN connection
            match endpoint.connect(node_addr.clone(), b"riterm").await {
                Ok(conn) => {
                    info!("Connected with riterm ALPN");
                    conn
                }
                Err(e2) => {
                    error!("Failed to connect with riterm ALPN: {}", e2);
                    return Err(anyhow::anyhow!("Failed to connect to remote host: {} / {}", e1, e2));
                }
            }
        }
    };

    let remote_node_id = connection.remote_node_id()
        .context("Failed to get remote node ID")?;
    
    info!("Connected to remote host: {}", remote_node_id);

    // Open bidirectional stream
    let (mut send, mut recv) = connection.open_bi().await
        .context("Failed to open bidirectional stream")?;

    // Send dumbpipe handshake - fixed 5-byte "hello"
    send.write_all(b"hello").await
        .context("Failed to send handshake")?;
    send.flush().await
        .context("Failed to flush handshake")?;

    info!("Sent handshake to remote host");

    // Read handshake response - expecting "RITERM_READY" (12 bytes)
    let mut buf = [0u8; 12];
    recv.read_exact(&mut buf).await
        .context("Failed to read handshake response")?;
    
    if buf != *b"RITERM_READY" {
        warn!("Invalid handshake response from remote host: {:?}", buf);
        return Err(anyhow::anyhow!("Invalid handshake response: {:?}", buf));
    }

    info!("Handshake verified with remote host");

    // Send a test shell command
    let command = "echo 'Hello from Test Client!'";
    let command_line = format!("SHELL:{}\n", command);
    send.write_all(command_line.as_bytes()).await
        .context("Failed to send shell command")?;
    send.flush().await
        .context("Failed to flush shell command")?;
    
    info!("Sent shell command: {}", command);

    // Try to read some output
    let mut output_buf = [0u8; 1024];
    tokio::time::sleep(Duration::from_millis(500)).await; // Give server time to respond
    
    match recv.read(&mut output_buf).await {
        Ok(Some(n)) => {
            let output = String::from_utf8_lossy(&output_buf[..n]);
            println!("✅ Received output: {}", output);
        }
        Ok(None) => {
            println!("Connection closed by server");
        }
        Err(e) => {
            println!("❌ Failed to read output: {}", e);
        }
    }

    // Send exit command
    send.write_all(b"EXIT\n").await
        .context("Failed to send exit command")?;
    send.flush().await
        .context("Failed to flush exit command")?;
    
    info!("Sent exit command");
    println!("✅ Connection test completed successfully!");

    Ok(())
}