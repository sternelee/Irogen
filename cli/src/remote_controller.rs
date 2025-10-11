use anyhow::Result;
use tracing::error;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent},
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType},
    cursor::{MoveTo, Show, Hide},
};
use std::io::{self, Write};
use tokio::sync::mpsc;

use riterm_shared::p2p::{P2PNetwork, GossipSender};

/// 远程终端控制器
pub struct RemoteTerminalController {
    network: P2PNetwork,
    session_id: String,
    sender: GossipSender,
    command_sender: mpsc::UnboundedSender<ControllerCommand>,
}

#[derive(Debug, Clone)]
pub enum ControllerCommand {
    CreateTerminal {
        name: Option<String>,
        shell: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    },
    StopTerminal { terminal_id: String },
    ListTerminals,
    CreateWebShare {
        local_port: u16,
        public_port: Option<u16>,
        service_name: String,
        terminal_id: Option<String>,
    },
    StopWebShare { public_port: u16 },
    ListWebShares,
    ShowStats,
    Help,
    Exit,
}

impl RemoteTerminalController {
    pub fn new(network: P2PNetwork, session_id: String, sender: GossipSender) -> (Self, mpsc::UnboundedReceiver<ControllerCommand>) {
        let (command_sender, command_receiver) = mpsc::unbounded_channel();

        let controller = Self {
            network,
            session_id,
            sender,
            command_sender,
        };

        (controller, command_receiver)
    }

    /// 启动交互式远程控制界面
    pub async fn start_interactive_mode(&mut self) -> Result<()> {
        self.print_welcome_message().await?;

        // 启动命令处理循环
        let mut command_receiver = {
            let (_tx, rx) = mpsc::unbounded_channel();
            let command_sender_clone = self.command_sender.clone();

            // 在后台线程中处理用户输入
            let mut command_sender = command_sender_clone;
            tokio::spawn(async move {
                if let Err(e) = Self::handle_user_input(&mut command_sender).await {
                    eprintln!("Input handling error: {}", e);
                }
            });

            rx
        };

        // 处理命令
        while let Some(command) = command_receiver.recv().await {
            match command {
                ControllerCommand::Exit => {
                    println!("👋 Exiting remote controller");
                    break;
                }
                ControllerCommand::Help => {
                    self.print_help()?;
                }
                _ => {
                    if let Err(e) = self.execute_command(command).await {
                        error!("Failed to execute command: {}", e);
                    }
                }
            }
        }

        // 清理终端
        Self::cleanup_terminal()?;
        Ok(())
    }

    async fn print_welcome_message(&self) -> Result<()> {
        execute!(
            io::stdout(),
            Clear(ClearType::All),
            MoveTo(0, 0),
            SetForegroundColor(Color::Blue),
            Print("╭─────────────────────────────────────────────╮\n"),
            Print("│       🤖 Remote Terminal Controller         │\n"),
            Print("│             P2P Management Mode               │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )?;

        println!("🎯 Connected to session: {}", &self.session_id[..16]);
        println!("🔗 Your Node ID: {}", &self.network.get_node_id().await[..16]);
        println!();
        println!("💡 Available Commands:");
        println!("   help     - Show this help message");
        println!("   create   - Create a new terminal");
        println!("   stop     - Stop a terminal");
        println!("   list     - List all terminals");
        println!("   webshare - Create a WebShare");
        println!("   ws-stop  - Stop a WebShare");
        println!("   ws-list  - List all WebShares");
        println!("   stats    - Show system statistics");
        println!("   exit     - Exit controller");
        println!();
        println!("🎮 Type a command and press Enter...");

        Ok(())
    }

    fn print_help(&self) -> Result<()> {
        execute!(
            io::stdout(),
            Clear(ClearType::All),
            MoveTo(0, 0),
            SetForegroundColor(Color::Cyan),
            Print("📖 Remote Controller Help\n"),
            ResetColor,
            Print("\n")
        )?;

        println!("🖥️  Terminal Management:");
        println!("   create                    - Create a new terminal with interactive prompts");
        println!("   create <name>             - Create terminal with specified name");
        println!("   stop <terminal_id>        - Stop a terminal (use ID or name)");
        println!("   list                      - List all active terminals");
        println!();
        println!("🌐 WebShare Management:");
        println!("   webshare <local_port>    - Create WebShare for local service");
        println!("   webshare <lp>:<pp>        - Create WebShare with specific public port");
        println!("   ws-stop <public_port>     - Stop a WebShare");
        println!("   ws-list                   - List all active WebShares");
        println!();
        println!("📊 System Information:");
        println!("   stats                     - Show system statistics");
        println!("   help                      - Show this help message");
        println!("   exit                      - Exit controller");
        println!();
        println!("💡 Examples:");
        println!("   create myterm              - Create terminal named 'myterm'");
        println!("   webshare 3000:8080         - Share local port 3000 as public port 8080");
        println!("   stop abc123                - Stop terminal with ID starting with 'abc123'");

        Ok(())
    }

    async fn execute_command(&mut self, command: ControllerCommand) -> Result<()> {
        match command {
            ControllerCommand::CreateTerminal { name, shell, working_dir, size } => {
                if let Err(e) = self.network.send_terminal_create(
                    &self.session_id,
                    &self.sender,
                    name,
                    shell,
                    working_dir,
                    size,
                ).await {
                    eprintln!("Failed to send terminal create command: {}", e);
                } else {
                    println!("✅ Terminal creation command sent");
                }
            }

            ControllerCommand::StopTerminal { terminal_id } => {
                if let Err(e) = self.network.send_terminal_stop(
                    &self.session_id,
                    &self.sender,
                    terminal_id,
                ).await {
                    eprintln!("Failed to send terminal stop command: {}", e);
                } else {
                    println!("✅ Terminal stop command sent");
                }
            }

            ControllerCommand::ListTerminals => {
                if let Err(e) = self.network.send_terminal_list_request(
                    &self.session_id,
                    &self.sender,
                ).await {
                    eprintln!("Failed to send terminal list request: {}", e);
                } else {
                    println!("📋 Terminal list request sent");
                }
            }

            ControllerCommand::CreateWebShare { local_port, public_port, service_name, terminal_id } => {
                if let Err(e) = self.network.send_webshare_create(
                    &self.session_id,
                    &self.sender,
                    local_port,
                    public_port,
                    service_name,
                    terminal_id,
                ).await {
                    eprintln!("Failed to send WebShare create command: {}", e);
                } else {
                    println!("✅ WebShare creation command sent");
                }
            }

            ControllerCommand::StopWebShare { public_port } => {
                if let Err(e) = self.network.send_webshare_stop(
                    &self.session_id,
                    &self.sender,
                    public_port,
                ).await {
                    eprintln!("Failed to send WebShare stop command: {}", e);
                } else {
                    println!("✅ WebShare stop command sent");
                }
            }

            ControllerCommand::ListWebShares => {
                if let Err(e) = self.network.send_webshare_list_request(
                    &self.session_id,
                    &self.sender,
                ).await {
                    eprintln!("Failed to send WebShare list request: {}", e);
                } else {
                    println!("📋 WebShare list request sent");
                }
            }

            ControllerCommand::ShowStats => {
                if let Err(e) = self.network.send_stats_request(
                    &self.session_id,
                    &self.sender,
                ).await {
                    eprintln!("Failed to send stats request: {}", e);
                } else {
                    println!("📊 Statistics request sent");
                }
            }

            _ => {}
        }

        Ok(())
    }

    async fn handle_user_input(command_sender: &mut mpsc::UnboundedSender<ControllerCommand>) -> Result<()> {
        enable_raw_mode()?;
        execute!(io::stdout(), EnableMouseCapture, Hide)?;

        let mut input = String::new();

        loop {
            if let Ok(Event::Key(KeyEvent { code, .. })) = event::read() {
                match code {
                    KeyCode::Enter => {
                        if !input.is_empty() {
                            let command = Self::parse_command(&input);
                            if let Some(cmd) = command {
                                command_sender.send(cmd)?;
                            }
                            input.clear();
                            print!("\n🎮 > ");
                            io::stdout().flush()?;
                        }
                    }
                    KeyCode::Char(c) => {
                        input.push(c);
                        print!("{}", c);
                        io::stdout().flush()?;
                    }
                    KeyCode::Backspace => {
                        if !input.is_empty() {
                            input.pop();
                            print!("\x08 \x08");
                            io::stdout().flush()?;
                        }
                    }
                    KeyCode::Esc => {
                        command_sender.send(ControllerCommand::Exit)?;
                        break;
                    }
                    _ => {}
                }
            }
        }

        Ok(())
    }

    fn parse_command(input: &str) -> Option<ControllerCommand> {
        let parts: Vec<&str> = input.trim().split_whitespace().collect();
        if parts.is_empty() {
            return None;
        }

        match parts[0].to_lowercase().as_str() {
            "help" | "h" => Some(ControllerCommand::Help),
            "exit" | "quit" | "q" => Some(ControllerCommand::Exit),
            "create" | "c" => {
                if parts.len() >= 2 {
                    Some(ControllerCommand::CreateTerminal {
                        name: Some(parts[1].to_string()),
                        shell: None,
                        working_dir: None,
                        size: None,
                    })
                } else {
                    Some(ControllerCommand::CreateTerminal {
                        name: None,
                        shell: None,
                        working_dir: None,
                        size: None,
                    })
                }
            }
            "stop" => {
                if parts.len() >= 2 {
                    Some(ControllerCommand::StopTerminal {
                        terminal_id: parts[1].to_string(),
                    })
                } else {
                    None
                }
            }
            "list" | "ls" => Some(ControllerCommand::ListTerminals),
            "webshare" | "ws" => {
                if parts.len() >= 2 {
                    if let Ok((local_port, public_port)) = Self::parse_port_mapping(parts[1]) {
                        Some(ControllerCommand::CreateWebShare {
                            local_port,
                            public_port,
                            service_name: format!("Port {}", local_port),
                            terminal_id: None,
                        })
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            "ws-stop" => {
                if parts.len() >= 2 {
                    if let Ok(port) = parts[1].parse::<u16>() {
                        Some(ControllerCommand::StopWebShare { public_port: port })
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            "ws-list" => Some(ControllerCommand::ListWebShares),
            "stats" => Some(ControllerCommand::ShowStats),
            _ => None,
        }
    }

    fn parse_port_mapping(port_str: &str) -> Result<(u16, Option<u16>)> {
        let parts: Vec<&str> = port_str.split(':').collect();

        match parts.len() {
            1 => {
                let local_port: u16 = parts[0].parse()?;
                Ok((local_port, None)) // None 表示自动分配
            }
            2 => {
                let local_port: u16 = parts[0].parse()?;
                let public_port: u16 = parts[1].parse()?;
                Ok((local_port, Some(public_port)))
            }
            _ => Err(anyhow::anyhow!("Invalid port format")),
        }
    }

    fn cleanup_terminal() -> Result<()> {
        execute!(
            io::stdout(),
            DisableMouseCapture,
            Show,
            ResetColor
        )?;
        disable_raw_mode()?;
        Ok(())
    }
}

impl Drop for RemoteTerminalController {
    fn drop(&mut self) {
        let _ = Self::cleanup_terminal();
    }
}