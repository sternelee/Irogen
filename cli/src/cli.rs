use anyhow::{Context, Result};
use clap::Parser;
use tracing::{info, warn, error};

#[derive(Parser)]
#[command(name = "riterm")]
#[command(about = "Riterm CLI - DumbPipe P2P Terminal Host")]
pub struct Cli {
    #[arg(
        long,
        help = "Custom relay server URL (e.g., https://relay.example.com)"
    )]
    pub relay: Option<String>,

    #[arg(long, help = "Authentication token for ticket submission")]
    pub auth: Option<String>,

    #[arg(long, help = "Test connection to remote host using NodeTicket")]
    pub test_connect: Option<String>,
}

pub struct CliApp;

impl CliApp {
    pub fn print_banner() {
        use crossterm::{
            cursor, execute,
            style::{Color, Print, ResetColor, SetForegroundColor},
            terminal::{Clear, ClearType},
        };
        use std::io;

        execute!(
            io::stdout(),
            Clear(ClearType::All),
            cursor::MoveTo(0, 0),
            SetForegroundColor(Color::Blue),
            Print("╭─────────────────────────────────────────────╮\n"),
            Print("│         🚀 Riterm DumbPipe Host              │\n"),
            Print("│      P2P Terminal with NodeTickets          │\n"),
            Print("│                                             │\n"),
            Print("│  🔗 Share tickets with remote clients       │\n"),
            Print("│  💻 Simple, secure P2P terminal access      │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )
        .ok();
    }

    pub async fn new(_relay: Option<String>) -> Result<Self> {
        Ok(Self)
    }

    pub async fn run(&mut self, cli: Cli) -> Result<()> {
        // Check if we should test connection to remote host
        if let Some(node_ticket_str) = cli.test_connect {
            return self.test_connection_to_host(node_ticket_str).await;
        }
        
        // 直接启动dumbpipe主机模式 - 创建node ticket
        self.start_dumbpipe_host().await
    }

    /// 启动dumbpipe主机模式
    async fn start_dumbpipe_host(&self) -> Result<()> {
        use crate::dumbpipe_host::DumbPipeHost;

        // 创建dumbpipe主机
        let dumbpipe_host = DumbPipeHost::new(None).await
            .context("Failed to create DumbPipe host")?;

        // 启动主机服务 - 这会显示ticket并开始监听
        let _ticket = dumbpipe_host.start().await
            .context("Failed to start DumbPipe host")?;

        // 保持运行直到用户中断
        tokio::signal::ctrl_c().await?;
        println!("\n👋 Riterm host stopped");

        Ok(())
    }

    /// 测试连接到远程主机
    async fn test_connection_to_host(&self, node_ticket_str: String) -> Result<()> {
        use iroh::Endpoint;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use riterm_shared::NodeTicket;
        
        println!("Testing connection to remote host...");
        println!("Node Ticket: {}", node_ticket_str);
        
        // Parse the ticket
        let ticket = node_ticket_str.parse::<NodeTicket>()
            .context("Failed to parse NodeTicket")?;
        
        // Create iroh endpoint - 客户端不设置ALPN（与官方dumbpipe一致）
        let endpoint = Endpoint::builder()
            .alpns(vec![])  // 客户端不设置ALPN
            .discovery_n0()
            .bind()
            .await?;

        // Wait for endpoint to be ready
        endpoint.online().await;
        
        println!("Attempting to connect to node: {}", ticket.node_addr().node_id);
        
        // Use DUMBPIPEV0 ALPN connection
        let connection = endpoint.connect(ticket.node_addr().clone(), b"DUMBPIPEV0")
            .await
            .context("Failed to connect to remote host with DUMBPIPEV0 ALPN")?;

        let remote_node_id = connection.remote_node_id()
            .context("Failed to get remote node ID")?;
        
        println!("✅ Connected to remote host: {}", remote_node_id);

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

        println!("✅ Handshake verified with remote host");

        // Send a test shell command
        let command = "echo 'Hello from Test Client!'";
        let command_line = format!("SHELL:{}\n", command);
        send.write_all(command_line.as_bytes()).await
            .context("Failed to send shell command")?;
        send.flush().await
            .context("Failed to flush shell command")?;
        
        println!("Sent test command: {}", command);

        // Try to read some output
        let mut output_buf = [0u8; 1024];
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await; // Give server time to respond
        
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
        
        println!("✅ Connection test completed successfully!");
        Ok(())
    }
}