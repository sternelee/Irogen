/// 真正的dumbpipe客户端 - 基于dumbpipe官方实现模式
/// 使用NodeTicket连接到远程CLI主机
use anyhow::{Context, Result};
use iroh::Endpoint;
use riterm_shared::NodeTicket;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};

/// 真正的dumbpipe客户端 - 基于官方dumbpipe实现
pub struct DumbPipeClient {
    endpoint: Endpoint,
}

/// 已连接的dumbpipe客户端
pub struct ConnectedDumbPipe {
    send: iroh::endpoint::SendStream,
    recv: iroh::endpoint::RecvStream,
    remote_node_id: iroh::NodeId,
}

impl DumbPipeClient {
    /// 创建新的dumbpipe客户端
    pub async fn new() -> Result<Self> {
        // 创建iroh endpoint - 使用官方dumbpipe相同的方式（客户端不设置ALPN）
        let endpoint = Endpoint::builder()
            .alpns(vec![]) // 客户端不设置ALPN，在连接时指定
            .discovery_n0()
            .bind()
            .await?;

        // 等待endpoint准备就绪
        endpoint.online().await;

        Ok(Self { endpoint })
    }

    /// 连接到远程dumbpipe主机
    pub async fn connect(&self, ticket: &NodeTicket) -> Result<ConnectedDumbPipe> {
        info!("Connecting to remote host: {}", ticket.node_addr().node_id);

        // 使用DUMBPIPEV0 ALPN连接 - 按照官方dumbpipe的方式
        let connection = self
            .endpoint
            .connect(ticket.node_addr().clone(), b"DUMBPIPEV0")
            .await
            .context("Failed to connect to remote host with DUMBPIPEV0 ALPN")?;

        let remote_node_id = connection
            .remote_node_id()
            .context("Failed to get remote node ID")?;

        info!("Connected to remote host: {}", remote_node_id);

        // 打开双向流 - 模仿dumbpipe的open_bi()
        let (mut send, mut recv) = connection
            .open_bi()
            .await
            .context("Failed to open bidirectional stream")?;

        // 发送dumbpipe握手 - 固定5字节"hello"
        send.write_all(b"hello")
            .await
            .context("Failed to send handshake")?;
        send.flush().await.context("Failed to flush handshake")?;

        info!("Sent handshake to remote host");

        // 验证远程握手响应
        let mut buf = [0u8; 12]; // "RITERM_READY" is 12 bytes
        recv.read_exact(&mut buf)
            .await
            .context("Failed to read handshake response")?;

        if buf != *b"RITERM_READY" {
            warn!("Invalid handshake response from remote host");
            return Err(anyhow::anyhow!("Invalid handshake response"));
        }

        info!("Handshake verified with remote host");

        Ok(ConnectedDumbPipe {
            send,
            recv,
            remote_node_id,
        })
    }
}

impl ConnectedDumbPipe {
    /// 发送shell命令
    pub async fn send_shell_command(&mut self, command: &str) -> Result<()> {
        let command_line = format!("SHELL:{}\n", command);
        self.send
            .write_all(command_line.as_bytes())
            .await
            .context("Failed to send shell command")?;
        self.send
            .flush()
            .await
            .context("Failed to flush shell command")?;

        info!("Sent shell command: {}", command);
        Ok(())
    }

    /// 发送终端大小调整命令
    pub async fn send_resize_command(&mut self, rows: u16, cols: u16) -> Result<()> {
        let command_line = format!("RESIZE:{} {}\n", rows, cols);
        self.send
            .write_all(command_line.as_bytes())
            .await
            .context("Failed to send resize command")?;
        self.send
            .flush()
            .await
            .context("Failed to flush resize command")?;

        info!("Sent resize command: {}x{}", rows, cols);
        Ok(())
    }

    /// 发送退出命令
    pub async fn send_exit_command(&mut self) -> Result<()> {
        self.send
            .write_all(b"EXIT\n")
            .await
            .context("Failed to send exit command")?;
        self.send
            .flush()
            .await
            .context("Failed to flush exit command")?;

        info!("Sent exit command");
        Ok(())
    }

    /// 读取远程输出
    pub async fn read_output(&mut self) -> Result<String> {
        let mut buf = [0u8; 4096];
        let bytes_read = self
            .recv
            .read(&mut buf)
            .await
            .context("Failed to read output")?;

        if let Some(0) = bytes_read {
            return Ok(String::new()); // Connection closed
        }

        if let Some(n) = bytes_read {
            let output = String::from_utf8_lossy(&buf[..n]).to_string();
            Ok(output)
        } else {
            Err(anyhow::anyhow!("Failed to read output"))
        }
    }

    /// 获取远程节点ID
    pub fn remote_node_id(&self) -> iroh::NodeId {
        self.remote_node_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dumbpipe_client_creation() {
        let client = DumbPipeClient::new().await;
        assert!(client.is_ok());
    }

    #[test]
    fn test_command_formatting() {
        // Test command formatting
        let shell_cmd = format!("SHELL:{}\n", "ls -la");
        assert_eq!(shell_cmd, "SHELL:ls -la\n");

        let resize_cmd = format!("RESIZE:{} {}\n", 24, 80);
        assert_eq!(resize_cmd, "RESIZE:24 80\n");
    }
}

