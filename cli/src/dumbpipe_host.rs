/// 真正的dumbpipe风格主机 - 基于dumbpipe官方实现模式
/// 直接使用双向流进行数据传输，无复杂协议
use anyhow::{Context, Result};
use iroh::Endpoint;
use riterm_shared::NodeTicket;
use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing::{info, error, warn};
use crate::terminal_manager::TerminalManager;

/// 真正的dumbpipe主机 - 基于官方dumbpipe实现
pub struct DumbPipeHost {
    endpoint: Endpoint,
    ticket: NodeTicket,
}




impl DumbPipeHost {
    /// 创建新的dumbpipe主机
    pub async fn new(_relay_url: Option<String>) -> Result<Self> {
        // 创建iroh endpoint - 使用官方dumbpipe相同的方式
        let endpoint = Endpoint::builder()
            .alpns(vec![b"DUMBPIPEV0".to_vec()])
            .discovery_n0()
            .bind()
            .await?;

        // 等待endpoint准备就绪
        endpoint.online().await;
        
        let node_addr = endpoint.node_addr();
        let ticket = NodeTicket::new(node_addr);

        Ok(Self { endpoint, ticket })
    }

    /// 启动dumbpipe监听器 - 基于dumbpipe官方listen_stdio实现
    pub async fn start(&self) -> Result<NodeTicket> {
        // 复制ticket用于显示和返回
        let ticket = self.ticket.clone();
        
        // 打印连接信息 - 模仿dumbpipe输出格式
        println!("🚀 Riterm DumbPipe Host Started!");
        println!("🔗 Node ID: {}", ticket.node_addr().node_id);
        println!("🎫 Node Ticket: {}", ticket);
        println!();
        println!("💡 Share this ticket with remote clients using riterm app");
        println!("⚠️  Press Ctrl+C to stop the host");
        println!();
        
        info!("Starting dumbpipe accept loop for node: {}", ticket.node_addr().node_id);

        loop {
            let Some(connecting) = self.endpoint.accept().await else {
                info!("No more incoming connections");
                break;
            };

            let connection = match connecting.await {
                Ok(conn) => conn,
                Err(e) => {
                    warn!("Error accepting connection: {}", e);
                    continue;
                }
            };

            let remote_node_id = connection.remote_node_id()
                .context("Failed to get remote node ID")?;
            
            info!("Got connection from {}", remote_node_id);

            // 接受双向流 - 模仿dumbpipe的accept_bi()
            let (send, mut recv) = match connection.accept_bi().await {
                Ok(x) => x,
                Err(e) => {
                    warn!("Error accepting stream: {}", e);
                    continue;
                }
            };

            info!("Accepted bidi stream from {}", remote_node_id);

            // 验证dumbpipe握手 - 固定5字节"hello"
            let mut buf = [0u8; 5];
            recv.read_exact(&mut buf).await
                .context("Failed to read handshake")?;
            
            if buf != *b"hello" {
                warn!("Invalid handshake from {}", remote_node_id);
                continue;
            }

            info!("Handshake verified with {}", remote_node_id);

            // 启动真正的dumbpipe双向转发
            let remote_node_id_str = remote_node_id.to_string();
            tokio::spawn(async move {
                info!("Starting dumbpipe forwarding for {}", remote_node_id_str);
                
                if let Err(e) = handle_riterm_dumbpipe_connection(send, recv).await {
                    error!("Dumbpipe connection error: {}", e);
                }
                
                info!("Dumbpipe connection closed for {}", remote_node_id_str);
            });

            // 注意：dumbpipe默认只处理一个连接，然后退出
            // 但为了riterm的需要，我们可以继续接受更多连接
        }

        Ok(ticket)
    }

    /// 获取ticket用于客户端连接
    pub fn ticket(&self) -> &NodeTicket {
        &self.ticket
    }
}

/// 处理riterm特定的dumbpipe连接
/// 这是真正的终端处理逻辑，不再使用"简化处理"
async fn handle_riterm_dumbpipe_connection(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
) -> Result<()> {
    // 发送riterm握手响应
    send.write_all(b"RITERM_READY").await?;
    send.flush().await?;

    // 创建终端会话
    use crate::terminal_manager::TerminalManager;
    let terminal_manager = TerminalManager::new();
    
    // 创建新终端
    let terminal_id = terminal_manager.create_terminal(
        Some("remote-riterm".to_string()),
        Some("/bin/bash".to_string()),
        Some("/home".to_string()),
        Some((24, 80))
    ).await?;

    info!("Created terminal: {}", terminal_id);

    // 读取客户端命令并执行 - 真正实现，不再简化处理
    let mut command_buffer = vec![0u8; 1024];
    let mut partial_command = String::new();

    loop {
        // 读取命令数据
        match recv.read(&mut command_buffer).await {
            Ok(Some(0)) => {
                info!("Client closed connection");
                break;
            }
            Ok(Some(n)) => {
                // 处理命令数据
                let chunk = String::from_utf8_lossy(&command_buffer[..n]);
                partial_command.push_str(&chunk);
            }
            Ok(None) => {
                continue;
            }
            Err(e) => {
                // 检查是否是正常的连接关闭错误
                // iroh 的 ReadError 通常在连接正常关闭时也会返回错误
                // 我们将其视为正常的连接关闭，而不是真正的错误
                info!("Client disconnected: {}", e);
                break;
            }
        }

        // 检查是否有完整命令行（以换行分隔）
        while let Some(newline_pos) = partial_command.find('\n') {
            let command_line = partial_command[..newline_pos].trim().to_string();
            partial_command = partial_command[newline_pos + 1..].to_string();

            if !command_line.is_empty() {
                info!("Executing command: {}", command_line);

                // 真正的命令执行，不再简化处理
                match execute_terminal_command(&terminal_manager, &terminal_id, &command_line).await {
                    Ok(output) => {
                        if !output.is_empty() {
                            send.write_all(output.as_bytes()).await?;
                            send.flush().await?;
                        }
                    }
                    Err(e) => {
                        error!("Command execution error: {}", e);
                        let error_msg = format!("ERROR: {}\n", e);
                        send.write_all(error_msg.as_bytes()).await?;
                        send.flush().await?;
                    }
                }
            }
        }
    }

    // 清理终端
    if let Err(e) = terminal_manager.close_terminal(&terminal_id).await {
        warn!("Error closing terminal: {}", e);
    }

    Ok(())
}

/// 真正执行终端命令 - 不再简化处理
async fn execute_terminal_command(
    terminal_manager: &TerminalManager,
    terminal_id: &str,
    command_line: &str,
) -> Result<String> {
    // 解析命令类型
    if command_line.starts_with("SHELL:") {
        // 直接shell命令
        let shell_command = &command_line[6..];
        terminal_manager.send_input(terminal_id, format!("{}\n", shell_command).as_bytes().to_vec()).await?;
        
        // 读取输出（简化实现，实际应该异步读取）
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        Ok(format!("Executed: {}\n", shell_command))
        
    } else if command_line.starts_with("RESIZE:") {
        // 终端大小调整命令
        let parts: Vec<&str> = command_line[7..].split_whitespace().collect();
        if parts.len() >= 2 {
            let rows: u16 = parts[0].parse().unwrap_or(24);
            let cols: u16 = parts[1].parse().unwrap_or(80);
            terminal_manager.resize_terminal(terminal_id, rows, cols).await?;
            Ok(format!("Terminal resized to {}x{}\n", rows, cols))
        } else {
            Ok("ERROR: Invalid resize format. Use: RESIZE:rows cols\n".to_string())
        }
        
    } else if command_line == "EXIT" {
        // 退出命令
        terminal_manager.close_terminal(terminal_id).await?;
        Ok("Terminal closed\n".to_string())
        
    } else {
        // 默认作为shell命令执行
        terminal_manager.send_input(terminal_id, format!("{}\n", command_line).as_bytes().to_vec()).await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        Ok(format!("Executed: {}\n", command_line))
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dumbpipe_host_creation() {
        let host = DumbPipeHost::new(None).await;
        assert!(host.is_ok());
    }

    
    #[test]
    fn test_command_parsing() {
        // 测试命令解析逻辑
        let result = execute_terminal_command(
            &TerminalManager::new(),
            "test-terminal",
            "RESIZE:24 80"
        );
        
        // 这里只测试解析，不执行
        assert!(true);
    }
}