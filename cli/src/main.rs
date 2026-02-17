use anyhow::{Context, Result};
use clap::Parser;

mod client;
mod command_router;
mod local_client;
mod message_server;
mod shell;
mod terminal_logger;
use clawdchat_shared::agent::run_claude_acp_agent;
use clawdchat_shared::QuicMessageServerConfig;
use local_client::{LocalClientConfig, LocalClientSession};
use message_server::CliMessageServer;
use tracing::info;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

/// Generate a string representation of a QR code for the given ticket.
fn generate_qr_string(ticket: &str) -> String {
    use fast_qr::{ECL, QRBuilder};

    match QRBuilder::new(ticket).ecl(ECL::M).build() {
        Ok(qr) => qr.to_str(),
        Err(_) => "[QR Code Error]".to_string(),
    }
}

#[derive(Parser)]
#[command(name = "clawdchat")]
#[command(about = "ClawdChat - P2P AI Agent Remote Management Tool")]
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
        /// Custom path to secret key file (default: ./clawdchat_secret_key)
        #[arg(long)]
        secret_key_file: Option<String>,
        /// Use temporary secret key (not persisted to disk)
        #[arg(long)]
        temp_key: bool,
    },
    /// Connect to a remote ClawdChat host server (P2P client mode)
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
    /// Run Claude ACP agent over stdio (used by host when spawning ClaudeAcp sessions)
    ClaudeAcpAgent,
}

#[tokio::main]
async fn main() -> Result<()> {
    // 设置日志系统
    setup_logging()?;

    // 解析命令行参数
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Run {
            agent,
            project,
            args,
        }) => run_agent_session(agent, project, args).await,
        Some(Commands::Host {
            relay,
            max_connections,
            bind_addr,
            secret_key_file,
            temp_key,
        }) => run_host(relay, max_connections, bind_addr, secret_key_file, temp_key).await,
        Some(Commands::Connect { ticket, relay }) => run_connect(ticket, relay).await,
        Some(Commands::Runner { bind_addr }) => run_runner(bind_addr).await,
        Some(Commands::ClaudeAcpAgent) => run_claude_acp_agent_cmd().await,
        None => {
            print_general_help();
            Ok(())
        }
    }
}

fn setup_logging() -> Result<()> {
    std::fs::create_dir_all("logs").ok();

    let file_appender = RollingFileAppender::new(Rotation::DAILY, "logs", "clawdchat-cli.log");
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
    info!("Starting ClawdChat Host Server");

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
        let default_path = current_dir.join("clawdchat_secret_key");
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

#[allow(unused_variables)]
fn print_host_info(node_id: &str, ticket: &str, shell_path: &str) {
    // Generate QR code
    let qr_code = generate_qr_string(ticket);

    // 在release模式下，只显示标题、shell和ticket
    #[cfg(not(debug_assertions))]
    {
        println!("🚀 ClawdChat Host Server");
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
        println!("🚀 ClawdChat Host Server Started");
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
        println!("   1. Open ClawdChat app on your mobile device");
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
    println!("🤖 ClawdChat - P2P AI Agent Remote Management Tool");
    println!();
    println!("📋 Commands:");
    println!("   clawdchat run [options]     Start an AI Agent session (default: claude)");
    println!("   clawdchat host [options]    Start P2P host server");
    println!("   clawdchat runner [options]  Start background runner service");
    println!("   clawdchat --help            Show this help message");
    println!();
    println!("💡 Quick Start:");
    println!("   1. Run: clawdchat run");
    println!("   2. In another terminal: clawdchat host");
    println!("   3. Connect your mobile app using the ticket");
    println!();
    println!("🔧 Agent Types:");
    println!("   claude                   Claude Code (Anthropic, SDK)");
    println!("   claude_acp               Claude via ACP (Zed-style)");
    println!("   opencode                 OpenCode (OpenAI)");
    println!("   gemini                   Gemini CLI (Google)");
    println!();
}

/// 运行 AI Agent 会话（使用 ACP）
async fn run_agent_session(agent: String, project: String, args: Vec<String>) -> Result<()> {
    use clawdchat_shared::message_protocol::AgentType;

    let agent_type = match agent.to_lowercase().as_str() {
        "claude" | "claude-code" => AgentType::ClaudeCode,
        "claude_acp" | "claudeacp" => AgentType::ClaudeAcp,
        "open" | "opencode" => AgentType::OpenCode,
        "gemini" => AgentType::Gemini,
        "codex" => AgentType::Codex,
        "copilot" => AgentType::Copilot,
        "qwen" => AgentType::Qwen,
        _ => {
            eprintln!("❌ Unknown agent type: {}", agent);
            eprintln!("   Supported: claude, claude_acp, opencode, gemini, codex, copilot, qwen");
            return Err(anyhow::anyhow!("Unknown agent type"));
        }
    };

    info!(
        "Starting AI Agent: {:?} in project: {}",
        agent_type, project
    );

    // 检查项目路径是否存在
    let project_path = std::path::PathBuf::from(&project);
    if !project_path.exists() {
        eprintln!("❌ Project path does not exist: {}", project);
        return Err(anyhow::anyhow!("Project path not found"));
    }

    // 创建本地 ACP 客户端配置
    let config = LocalClientConfig {
        agent_type,
        binary_path: None,
        extra_args: args,
        working_dir: project_path.clone(),
        home_dir: None,
    };

    // 启动会话
    let session = LocalClientSession::new(config)
        .await
        .context("Failed to start ACP session")?;

    let session_info = session.get_info();

    println!();
    println!("🌐 ACP Agent Session Started (Native Mode)");
    println!();
    println!("   Type:     {:?}", session_info.agent_type);
    println!("   Session:  {}", session_info.session_id);
    println!("   Project:  {}", project);
    println!();
    println!("Commands:");
    println!("  /listperms  - List pending permission requests");
    println!("  /approve    - Approve a permission request");
    println!("  /deny       - Deny a permission request");
    println!("  /interrupt  - Interrupt current operation");
    println!("  /quit       - Exit session");
    println!();
    println!("💬 Type your message and press Enter to send.");
    println!("   Type a slash command to interact with permissions.");
    println!("   Press Ctrl+C to exit.");
    println!();

    let stdin = tokio::io::stdin();
    let reader = tokio::io::BufReader::new(stdin);
    use tokio::io::AsyncBufReadExt;

    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.is_empty() {
            continue;
        }

        // 处理 slash commands
        if line.starts_with('/') {
            if let Err(e) = handle_slash_command(&session, &line).await {
                eprintln!("❌ Command error: {}", e);
            }
            continue;
        }

        // 发送消息到 agent
        if let Err(e) = session.send_message(line).await {
            eprintln!("❌ Failed to send message: {}", e);
        }
    }

    // 清理
    if let Err(e) = session.shutdown().await {
        eprintln!("⚠️ Failed to shutdown session: {}", e);
    }

    println!();
    println!("👋 Session ended");

    Ok(())
}

/// Handle slash commands in interactive mode
async fn handle_slash_command(session: &LocalClientSession, command: &str) -> Result<()> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Ok(());
    }

    match parts[0] {
        "/listperms" => {
            let perms = session.get_pending_permissions().await?;
            if perms.is_empty() {
                println!("✅ No pending permission requests");
            } else {
                println!("📋 Pending Permission Requests:");
                for (i, perm) in perms.iter().enumerate() {
                    println!("  {}. Request ID: {}", i + 1, perm.request_id);
                    println!("     Tool: {}", perm.tool_name);
                    if let Some(msg) = &perm.message {
                        println!("     Message: {}", msg);
                    }
                }
            }
        }
        "/approve" => {
            if parts.len() < 2 {
                println!("Usage: /approve <request_id>");
                return Ok(());
            }
            let request_id = parts[1].to_string();
            match session.respond_to_permission(request_id, true, None).await {
                Ok(_) => println!("✅ Permission approved"),
                Err(e) => eprintln!("❌ Failed to approve permission: {}", e),
            }
        }
        "/deny" => {
            if parts.len() < 2 {
                println!("Usage: /deny <request_id>");
                return Ok(());
            }
            let request_id = parts[1].to_string();
            let reason = if parts.len() > 2 {
                Some(parts[2..].join(" "))
            } else {
                None
            };
            match session
                .respond_to_permission(request_id, false, reason)
                .await
            {
                Ok(_) => println!("❌ Permission denied"),
                Err(e) => eprintln!("❌ Failed to deny permission: {}", e),
            }
        }
        "/interrupt" => match session.interrupt().await {
            Ok(_) => println!("⛔ Operation interrupted"),
            Err(e) => eprintln!("❌ Failed to interrupt: {}", e),
        },
        "/quit" | "/exit" => {
            println!("👋 Exiting session...");
            return Err(anyhow::anyhow!("quit_command"));
        }
        "/help" => {
            println!("Available commands:");
            println!("  /listperms  - List pending permission requests");
            println!("  /approve <id> - Approve a permission request");
            println!("  /deny <id> [reason] - Deny a permission request");
            println!("  /interrupt  - Interrupt current operation");
            println!("  /quit       - Exit session");
        }
        _ => {
            println!("❓ Unknown command: {}", parts[0]);
            println!("   Type /help for available commands");
        }
    }

    Ok(())
}

/// 运行后台 Runner 服务
async fn run_runner(bind_addr: String) -> Result<()> {
    info!("Starting ClawdChat Runner on {}", bind_addr);

    println!();
    println!("🔄 ClawdChat Runner");
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

/// Run the Claude ACP agent on stdio (current_thread + LocalSet for !Send ACP futures).
async fn run_claude_acp_agent_cmd() -> Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async move {
            run_claude_acp_agent(stdin, stdout, |fut| {
                tokio::task::spawn_local(fut);
            })
            .await
        })
        .await
}

/// 连接到远程 ClawdChat host（P2P 客户端模式）
async fn run_connect(ticket: String, relay: Option<String>) -> Result<()> {
    use client::InteractiveClient;

    println!();
    println!("🔗 ClawdChat P2P Client Mode");
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
