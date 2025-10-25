use anyhow::Result;
use riterm_app::dumbpipe_client::{DumbPipeClient};
use riterm_shared::NodeTicket;
use tokio;

#[tokio::main]
async fn main() -> Result<()> {
    // The NodeTicket from the CLI host
    let node_ticket_str = "nodeaddrcdrz6eeajzwnvpzcuyjahkkiw4exmrdfq2lypbnxxwccwd2h6ajpnb2hi4dthixs6ylqomys2mjoojswyylzfzxdaltjojxwqlldmfxgc4tzfzuxe33ifzwgs3tlfyxqmaaksd3xplnpamahrzlertlfeagavaaqf6x6amambkag7cw26ayaycuiwa5nv4bqbqfi24ak3lyd";
    
    println!("Testing connection to CLI host...");
    println!("Node Ticket: {}", node_ticket_str);
    
    // Parse the ticket
    let ticket = node_ticket_str.parse::<NodeTicket>()?;
    
    // Create dumbpipe client
    let client = DumbPipeClient::new().await?;
    
    println!("Attempting to connect to host...");
    
    // Try to connect
    match client.connect(&ticket).await {
        Ok(mut connected) => {
            println!("✅ Successfully connected to host!");
            println!("Remote Node ID: {}", connected.remote_node_id());
            
            // Test sending a command
            println!("Sending test command...");
            connected.send_shell_command("echo 'Hello from Riterm App!'").await?;
            
            // Read output
            match connected.read_output().await {
                Ok(output) => {
                    println!("✅ Received output: {}", output);
                }
                Err(e) => {
                    println!("❌ Failed to read output: {}", e);
                }
            }
            
            // Send exit command
            connected.send_exit_command().await?;
            println!("✅ Connection test completed successfully!");
        }
        Err(e) => {
            println!("❌ Failed to connect: {}", e);
            return Err(e);
        }
    }
    
    Ok(())
}