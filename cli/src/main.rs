use anyhow::{Context, Result};
use clap::Parser;

mod agent_wrapper;
mod client;
mod message_server;
mod shell;
mod terminal_logger;
use agent_wrapper::AgentManager;
use message_server::CliMessageServer;
use riterm_shared::QuicMessageServerConfig;
use tracing::info;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

/// Generate a string representation of a QR code for the given ticket.
fn generate_qr_string(ticket: &str) -> String {
    use fast_qr::{QRBuilder, ECL};

    match QRBuilder::new(ticket).ecl(ECL::M).build() {
        Ok(qr) => qr.to_str(),
        Err(_) => "[QR Code Error]".to_string(),
    }
}

#[derive(Parser)]
#[command(name = "riterm")]
#[command(about = "RiTerm - P2P AI Agent Remote Management Tool")]
#[command(version = env!("CARGO_PKG_VERSION"))]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Subcommand)]
enum Commands {
    /// Start an AI Agent session (Claude Code, OpenCode, Gemini)
    Run {
        /// AI Agent type
        #[arg(long, default_value = "claude")]
        agent: String,
        /// Project path
        #[arg(long, default_value = ".")]
        project: String,
        /// Additional arguments to pass to the agent
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
    },
    /// Start a terminal host server for app connections
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
        /// Custom path to secret key file (default: ./riterm_secret_key)
        #[arg(long)]
        secret_key_file: Option<String>,
        /// Use temporary secret key (not persisted to disk)
        #[arg(long)]
        temp_key: bool,
    },
    /// Connect to a remote RiTerm host server (P2P client mode)
    Connect {
        /// Connection ticket from remote host
        #[arg(long)]
        ticket: String,
        /// Relay server URL (optional, for NAT traversal)
        #[arg(long)]
        relay: Option<String>,
    },
    /// Start background runner for remote session spawning
    Runner {
        /// Bind address for the runner server
        #[arg(long, default_value = "127.0.0.1:8765")]
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
        Some(Commands::Run { agent, project, args }) => {
            run_agent_session(agent, project, args).await
        }
        Some(Commands::Host {
            relay,
            max_connections,
            bind_addr,
            secret_key_file,
            temp_key,
        }) => run_host(relay, max_connections, bind_addr, secret_key_file, temp_key).await,
        Some(Commands::Connect { ticket, relay }) => {
            run_connect(ticket, relay).await
        }
        Some(Commands::Runner { bind_addr }) => {
            run_runner(bind_addr).await
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
    let console_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "info".into()
        } else {
            "error".into() // Release模式下默认只显示错误日志
        }
    });

    let console_layer = tracing_subscriber::fmt::layer().with_filter(console_filter);

    tracing_subscriber::registry()
        .with(file_layer)
        .with(console_layer)
        .init();

    Ok(())
}

async fn run_host(
    relay: Option<String>,
    max_connections: usize,
    bind_addr: String,
    secret_key_file: Option<String>,
    temp_key: bool,
) -> Result<()> {
    info!("Starting RiTerm Host Server");

    // 处理密钥文件路径
    let secret_key_path = if temp_key {
        info!("🔑 Using temporary secret key (not persisted)");
        None
    } else if let Some(path) = secret_key_file {
        let path_buf = std::path::PathBuf::from(path);
        info!("🔑 Using custom secret key path: {:?}", path_buf);
        Some(path_buf)
    } else {
        // 默认使用CLI启动目录
        let current_dir = std::env::current_dir()?;
        let default_path = current_dir.join("riterm_secret_key");
        info!(
            "🔑 Using default secret key in CLI directory: {:?}",
            default_path
        );
        Some(default_path)
    };

    // 创建服务器配置
    let config = QuicMessageServerConfig {
        bind_addr: Some(bind_addr.parse()?),
        relay_url: relay,
        max_connections,
        heartbeat_interval: std::time::Duration::from_secs(30),
        timeout: std::time::Duration::from_secs(300),
        secret_key_path,
    };

    // 创建并启动消息服务器
    let server = CliMessageServer::new(config).await?;

    // 生成连接票据
    let node_id = server.get_node_id();
    let shell_path = server.get_default_shell_path();
    let ticket = server.generate_connection_ticket()?;

    // 显示票据信息
    print_host_info(&node_id, &ticket, shell_path);

    // 设置 Ctrl+C 处理
    let server_ref = &server;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received shutdown signal");
            server_ref.shutdown().await?;
            #[cfg(not(debug_assertions))]
            println!("🛑 Stopped");
            #[cfg(debug_assertions)]
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

fn print_host_info(node_id: &str, ticket: &str, shell_path: &str) {
    // Generate QR code
    let qr_code = generate_qr_string(ticket);

    // 在release模式下，只显示标题、shell和ticket
    #[cfg(not(debug_assertions))]
    {
        println!("🚀 RiTerm Host Server");
        println!("🐚 Shell: {}", shell_path);
        println!();
        println!("🎫 Scan QR code or use ticket below:");
        println!();
        println!("{}", qr_code);
        println!();
        println!("Ticket:");
        println!("{}", ticket);
        println!();
        println!("Press Ctrl+C to stop");
    }

    // 在debug模式下，显示完整信息
    #[cfg(debug_assertions)]
    {
        println!("🚀 RiTerm Host Server Started");
        println!("🔑 Node ID: {}", node_id);
        println!("🐚 Shell: {}", shell_path);
        println!();

        println!("🎫 Connection Ticket:");
        println!();
        println!("{}", qr_code);
        println!();
        println!("{}", &ticket);
        println!();

        println!("📱 App Connection Instructions:");
        println!("   1. Open RiTerm app on your mobile device");
        println!("   2. Tap the camera button to scan QR code");
        println!("   3. Or copy the ticket above and paste it in the app");
        println!();
        println!("✨ Your app is now ready to connect!");
        println!();
        println!("Press Ctrl+C to stop the server");
    }
}

async fn run_server_status_loop(server: &CliMessageServer) {
    let mut last_status = std::time::Instant::now();
    let mut last_connection_count = 0usize;

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let connections = server.get_active_connections_count().await;

        // 检测连接数量变化
        let connection_changed = connections != last_connection_count;

        // 每30秒打印一次状态，或者连接数变化时立即打印
        if connection_changed || last_status.elapsed() > std::time::Duration::from_secs(30) {
            if connections > 0 {
                if connection_changed {
                    if connections > last_connection_count {
                        println!("✅ Connected ({})", connections);
                    } else {
                        println!("🔌 Disconnected ({})", connections);
                    }
                } else {
                    #[cfg(debug_assertions)]
                    println!("📊 Active connections: {}", connections);
                }

                // 获取连接详情（仅在debug模式下显示）
                #[cfg(debug_assertions)]
                if let Ok(connection_info) = server.get_connection_info().await {
                    for (i, info) in connection_info.iter().enumerate() {
                        println!("  {}. {} (Node: {:?})", i + 1, info.id, info.node_id);
                    }
                }
            } else {
                #[cfg(debug_assertions)]
                println!("🔄 Server running - waiting for connections...");
            }
            last_status = std::time::Instant::now();
            last_connection_count = connections;
        }
    }
}

fn print_general_help() {
    println!("🤖 RiTerm - P2P AI Agent Remote Management Tool");
    println!();
    println!("📋 Commands:");
    println!("   riterm run [options]     Start an AI Agent session (default: claude)");
    println!("   riterm host [options]    Start P2P host server");
    println!("   riterm runner [options]  Start background runner service");
    println!("   riterm --help            Show this help message");
    println!();
    println!("💡 Quick Start:");
    println!("   1. Run: riterm run");
    println!("   2. In another terminal: riterm host");
    println!("   3. Connect your mobile app using the ticket");
    println!();
    println!("🔧 Agent Types:");
    println!("   claude                   Claude Code (Anthropic)");
    println!("   opencode                 OpenCode (OpenAI)");
    println!("   gemini                   Gemini CLI (Google)");
    println!();
}

/// 运行 AI Agent 会话
async fn run_agent_session(agent: String, project: String, args: Vec<String>) -> Result<()> {
    use riterm_shared::message_protocol::AgentType;

    let agent_type = match agent.to_lowercase().as_str() {
        "claude" | "claude-code" => AgentType::ClaudeCode,
        "open" | "opencode" => AgentType::OpenCode,
        "gemini" => AgentType::Gemini,
        _ => {
            eprintln!("❌ Unknown agent type: {}", agent);
            eprintln!("   Supported: claude, opencode, gemini");
            return Err(anyhow::anyhow!("Unknown agent type"));
        }
    };

    info!("Starting AI Agent: {:?} in project: {}", agent_type, project);

    // 创建 Agent 管理器
    let manager = AgentManager::new();

    // 检查项目路径是否存在
    let project_path = std::path::PathBuf::from(&project);
    if !project_path.exists() {
        eprintln!("❌ Project path does not exist: {}", project);
        return Err(anyhow::anyhow!("Project path not found"));
    }

    // 启动会话
    let (session_id, metadata) = manager
        .start_session(agent_type, project, args)
        .await
        .context("Failed to start agent session")?;

    println!();
    println!("🤖 AI Agent Session Started");
    println!();
    println!("   Type:     {:?}", metadata.agent_type);
    println!("   Session:  {}", metadata.session_id);
    println!("   Project:  {}", metadata.project_path);
    if let Some(branch) = metadata.git_branch {
        println!("   Branch:   {}", branch);
    }
    println!();
    println!("💬 Type your message and press Enter to send.");
    println!("   Press Ctrl+C to exit.");
    println!();

    // 简单的交互式循环
    // TODO: 实现完整的 stdin/stdout 处理
    let stdin = tokio::io::stdin();
    let reader = tokio::io::BufReader::new(stdin);
    use tokio::io::AsyncBufReadExt;

    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.is_empty() {
            continue;
        }

        // 发送消息到 agent
        if let Err(e) = manager.send_to_agent(&session_id, line).await {
            eprintln!("❌ Failed to send message: {}", e);
        }
    }

    // 清理
    let _ = manager.stop_session(&session_id).await;

    println!();
    println!("👋 Session ended");

    Ok(())
}

/// 运行后台 Runner 服务
async fn run_runner(bind_addr: String) -> Result<()> {
    info!("Starting RiTerm Runner on {}", bind_addr);

    println!();
    println!("🔄 RiTerm Runner");
    println!("   Listening on: {}", bind_addr);
    println!();
    println!("   The runner allows remote session spawning.");
    println!("   Press Ctrl+C to stop.");
    println!();

    // TODO: 实现 HTTP API 服务器用于远程会话生成
    // 这将允许 Tauri/Mobile 应用请求在本地启动新的 AI Agent 会话

    tokio::signal::ctrl_c().await?;
    println!();
    println!("🛑 Runner stopped");

    Ok(())
}

/// 连接到远程 RiTerm host（P2P 客户端模式）
async fn run_connect(ticket: String, relay: Option<String>) -> Result<()> {
    use client::InteractiveClient;

    println!();
    println!("🔗 RiTerm P2P Client Mode");
    println!();
    println!("🎫 Connecting to remote host...");
    println!();

    // 创建交互式客户端
    let mut client = InteractiveClient::new(ticket, relay);

    // 连接到远程 host
    client.connect().await?;

    println!();
    println!("✅ Connected! You can now:");
    println!("   • Type messages to send to AI agents");
    println!("   • Use /spawn to create new AI agent sessions");
    println!("   • Use /list to see available sessions");
    println!("   • Use /quit to disconnect");
    println!();

    // 运行交互式循环
    client.run_interactive().await?;

    Ok(())
}
