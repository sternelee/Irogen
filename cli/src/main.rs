use anyhow::Result;
use clap::Parser;

mod message_server;
use message_server::CliMessageServer;
use riterm_shared::QuicMessageServerConfig;
use tracing::info;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser)]
#[command(name = "riterm")]
#[command(about = "RiTerm - P2P Terminal Session Sharing Tool")]
#[command(version = env!("CARGO_PKG_VERSION"))]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Subcommand)]
enum Commands {
    /// Start a terminal host server for Flutter app connections
    Host {
        /// Optional custom relay server URL
        #[arg(long)]
        relay: Option<String>,
        /// Maximum number of concurrent connections
        #[arg(long, default_value = "50")]
        max_connections: usize,
        /// Bind address for the server
        #[arg(long, default_value = "0.0.0.0:0")]
        bind_addr: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // 设置日志系统
    setup_logging()?;

    // 解析命令行参数
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Host { relay, max_connections, bind_addr }) => {
            run_host(relay, max_connections, bind_addr).await
        }
        None => {
            print_general_help();
            Ok(())
        }
    }
}

fn setup_logging() -> Result<()> {
    std::fs::create_dir_all("logs").ok();

    let file_appender = RollingFileAppender::new(Rotation::DAILY, "logs", "riterm-cli.log");
    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_filter(EnvFilter::new("debug"));

    #[cfg(all(not(debug_assertions), feature = "release-logging"))]
    let console_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "error".into());

    #[cfg(not(all(not(debug_assertions), feature = "release-logging")))]
    let console_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    let console_layer = tracing_subscriber::fmt::layer().with_filter(console_filter);

    tracing_subscriber::registry()
        .with(file_layer)
        .with(console_layer)
        .init();

    Ok(())
}

async fn run_host(relay: Option<String>, max_connections: usize, bind_addr: String) -> Result<()> {
    info!("Starting RiTerm Host Server");

    // 创建服务器配置
    let config = QuicMessageServerConfig {
        bind_addr: Some(bind_addr.parse()?),
        relay_url: relay,
        max_connections,
        heartbeat_interval: std::time::Duration::from_secs(30),
        timeout: std::time::Duration::from_secs(300),
    };

    // 创建并启动消息服务器
    let server = CliMessageServer::new(config).await?;

    // 生成连接票据
    let ticket = server.generate_connection_ticket()?;
    let node_id = server.get_node_id();

    print_host_info(&node_id, &ticket);

    // 设置 Ctrl+C 处理
    let server_ref = &server;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received shutdown signal");
            server_ref.shutdown().await?;
            println!("🛑 Server stopped gracefully");
        }
        _ = async {
            // 保持服务器运行并显示状态
            run_server_status_loop(server_ref).await;
        } => {
            unreachable!()
        }
    }

    Ok(())
}

fn print_host_info(node_id: &str, ticket: &str) {
    println!("🚀 RiTerm Host Server Started");
    println!("🔑 Node ID: {}", node_id);
    println!();
    println!("🎫 Connection Ticket:");
    println!("┌─────────────────────────────────────────────────────────────┐");
    println!("│ {}", &ticket);
    if ticket.len() > 63 {
        println!("│ {} │", " ".repeat(ticket.len() - 63));
    }
    println!("└─────────────────────────────────────────────────────────────┘");
    println!();

    println!("📱 Flutter App Connection Instructions:");
    println!("   1. Start the Flutter app");
    println!("   2. Copy the connection ticket above");
    println!("   3. Paste the ticket in the app and connect");
    println!();
    println!("✨ Your Flutter app is now ready to connect!");
    println!("💡 The ticket contains all connection information needed");
    println!();
    println!("Press Ctrl+C to stop the server");
}

async fn run_server_status_loop(server: &CliMessageServer) {
    let mut last_status = std::time::Instant::now();

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let connections = server.get_active_connections_count().await;

        // 每30秒打印一次状态，或者有连接时立即打印
        if connections > 0 || last_status.elapsed() > std::time::Duration::from_secs(30) {
            if connections > 0 {
                println!("📊 Active connections: {}", connections);
            } else {
                println!("🔄 Server running - waiting for connections...");
            }
            last_status = std::time::Instant::now();
        }
    }
}

fn print_general_help() {
    println!("🚀 RiTerm - P2P Terminal Session Sharing Tool");
    println!();
    println!("📋 Commands:");
    println!("   riterm host              Start a terminal host server");
    println!("   riterm --help            Show this help message");
    println!();
    println!("💡 Quick Start:");
    println!("   1. Run: riterm host");
    println!("   2. Copy the connection ticket");
    println!("   3. Use it in your Flutter app");
    println!();
}