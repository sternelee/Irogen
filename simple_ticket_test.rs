// Simple test to verify ticket generation without prefix
use std::process::Command;

fn main() {
    println!("Testing ticket generation...");

    // Run the CLI command with a timeout
    let output = Command::new("timeout")
        .args(&["10s", "cargo", "run", "--bin", "cli", "--", "host", "--temp-key"])
        .output()
        .or_else(|_| {
            // Fallback if timeout command doesn't exist
            Command::new("gtimeout")
                .args(&["10s", "cargo", "run", "--bin", "cli", "--", "host", "--temp-key"])
                .output()
        })
        .or_else(|_| {
            // Final fallback - just run the command
            Command::new("cargo")
                .args(&["run", "--bin", "cli", "--", "host", "--temp-key"])
                .output()
        });

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            println!("=== STDOUT ===");
            println!("{}", stdout);

            if !stderr.is_empty() {
                println!("=== STDERR ===");
                println!("{}", stderr);
            }

            // Check for ticket lines
            let lines: Vec<&str> = stdout.lines().collect();
            let mut found_ticket = false;

            for (i, line) in lines.iter().enumerate() {
                if line.contains("🎫") {
                    println!("Found ticket line at index {}: {}", i, line);
                    // Look at the next few lines for the actual ticket
                    for j in (i+1)..std::cmp::min(i+5, lines.len()) {
                        if lines[j].trim().is_empty() {
                            continue;
                        }
                        println!("Potential ticket: {}", lines[j]);
                        found_ticket = true;

                        // Check if it has the prefix
                        if lines[j].starts_with("ticket:") {
                            println!("❌ Ticket still has 'ticket:' prefix");
                        } else {
                            println!("✅ Ticket does not have 'ticket:' prefix");
                        }
                    }
                }
            }

            if !found_ticket {
                println!("No ticket found in output");
            }
        }
        Err(e) => {
            println!("Failed to run command: {}", e);
        }
    }
}