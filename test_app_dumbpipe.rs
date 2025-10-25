use riterm_app::dumbpipe_client::{DumbPipeClient};
use riterm_shared::NodeTicket;
use tokio;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The NodeTicket from the running CLI host
    let node_ticket_str = "nodeadvjacblw4mlfd5obc5x42mygxa3fkve7mligaf5ndelrjt6xum3yajpnb2hi4dthixs6zlvmmys2mjoojswyylzfzxdaltjojxwqlldmfxgc4tzfzuxe33ifzwgs3tlfyxqmaaksd3xp26qamahrzlertgg4agavaaqfxunamambkag7dv5aayaycuiwa7l2abqbqfi24aoxuad";
    
    println!("Testing App DumbPipe Client...");
    println!("Node Ticket: {}", node_ticket_str);
    
    // Parse the ticket
    let ticket = node_ticket_str.parse::<NodeTicket>()?;
    
    // Create dumbpipe client
    let client = DumbPipeClient::new().await?;
    println!("✅ Created dumbpipe client");
    
    // Try to connect
    println!("Attempting to connect to host...");
    match client.connect(&ticket).await {
        Ok(mut connected) => {
            println!("✅ Successfully connected to host!");
            println!("Remote Node ID: {}", connected.remote_node_id());
            
            // Test sending a command
            println!("Sending test command...");
            match connected.send_shell_command("echo 'Hello from App Client!'").await {
                Ok(()) => {
                    println!("✅ Command sent successfully");
                    
                    // Try to read output
                    match connected.read_output().await {
                        Ok(output) => {
                            println!("✅ Received output: {}", output);
                        }
                        Err(e) => {
                            println!("❌ Failed to read output: {}", e);
                        }
                    }
                }
                Err(e) => {
                    println!("❌ Failed to send command: {}", e);
                }
            }
            
            // Send exit command
            match connected.send_exit_command().await {
                Ok(()) => println!("✅ Exit command sent"),
                Err(e) => println!("❌ Failed to send exit command: {}", e),
            }
            
            println!("✅ App dumbpipe test completed successfully!");
        }
        Err(e) => {
            println!("❌ Failed to connect: {}", e);
            return Err(e.into());
        }
    }
    
    Ok(())
}