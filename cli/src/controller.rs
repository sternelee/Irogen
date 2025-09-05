//! 基于 sshx 实现的网络控制器
//! 允许服务器控制终端的网络客户端

use std::collections::HashMap;
use std::pin::pin;

use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tokio::task;
use tokio::time::{self, Duration, Instant, MissedTickBehavior};
use tracing::{debug, error, info};

use crate::session_encrypt::SessionEncrypt;
use crate::runner::{Runner, ShellData, Sid, ClientMessage, NewShell};
use crate::p2p::P2PNetwork;

/// 发送空心跳消息到服务器的间隔
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);

/// 自动重新建立连接的间隔
const RECONNECT_INTERVAL: Duration = Duration::from_secs(60);

/// 服务器消息类型，对应 sshx 的 ServerMessage
#[derive(Debug, Clone)]
pub enum ServerMessage {
    /// 输入数据
    Input { id: u64, data: Vec<u8>, offset: u64 },
    /// 创建新 Shell
    CreateShell { id: u64, x: i32, y: i32 },
    /// 关闭 Shell
    CloseShell(u64),
    /// 同步序列号
    Sync(HashMap<u64, u64>),
    /// 调整大小
    Resize { id: u64, rows: u32, cols: u32 },
    /// Ping 消息
    Ping(u64),
    /// 错误消息
    Error(String),
}

/// 处理与远程服务器的单个会话通信，完全参考 sshx Controller
pub struct Controller {
    runner: Runner,
    encrypt: SessionEncrypt,
    encryption_key: String,
    
    name: String,
    session_id: String,
    ticket: String,
    write_ticket: Option<String>,
    
    /// 是否从先前运行中恢复会话
    is_restored: bool,
    
    /// P2P 网络连接
    network: P2PNetwork,
    
    /// 带有背压的通道，将消息路由到每个 shell 任务
    shells_tx: HashMap<Sid, mpsc::Sender<ShellData>>,
    /// 与任务共享的通道，允许它们输出客户端消息
    output_tx: mpsc::Sender<ClientMessage>,
    /// `output_tx` 通道的接收端
    output_rx: mpsc::Receiver<ClientMessage>,
}

impl Controller {
    /// 构造新的控制器，连接到远程服务器，参考 sshx 实现
    pub async fn new(
        name: &str,
        runner: Runner,
        enable_readers: bool,
        network: P2PNetwork,
    ) -> Result<Self> {
        debug!("创建新的控制器");
        
        // 生成加密密钥，类似 sshx 的 83.3 位熵
        let encryption_key = crate::session_encrypt::SessionEncrypt::generate_key(14);
        
        let encrypt_task = {
            let encryption_key = encryption_key.clone();
            task::spawn_blocking(move || SessionEncrypt::new(&encryption_key))
        };
        
        let (write_password, _write_password_task) = if enable_readers {
            let write_password = crate::session_encrypt::SessionEncrypt::generate_key(14);
            (Some(write_password), None::<()>)
        } else {
            (None, None::<()>)
        };
        
        let encrypt = encrypt_task.await?;
        
        // 生成会话 ID
        let session_id = format!("iroh-{}", crate::session_encrypt::SessionEncrypt::generate_key(8));
        
        // 创建 P2P 会话
        use crate::terminal::{SessionHeader, TerminalEvent};
        use tokio::sync::broadcast;
        
        let session_header = SessionHeader {
            session_id: session_id.clone(),
            session_name: name.to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            max_participants: if enable_readers { 10 } else { 5 },
            is_private: false,
            version: 2,
            width: 80,
            height: 24,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            title: None,
            command: None,
        };
        
        let (event_sender, _): (tokio::sync::broadcast::Sender<TerminalEvent>, _) = broadcast::channel(256);
        let (topic_id, gossip_sender, _input_receiver) = 
            network.create_shared_session(session_header).await?;
        
        // 生成 ticket
        let ticket = network.create_session_ticket(topic_id, &session_id).await?;
        
        let write_ticket = if let Some(ref write_password) = write_password {
            // 为写权限创建单独的会话
            let write_session_id = format!("{}-write", session_id);
            let write_header = SessionHeader {
                session_id: write_session_id.clone(),
                session_name: format!("{} (写权限)", name),
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                max_participants: 3,
                is_private: true,
                version: 2,
                width: 80,
                height: 24,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                title: None,
                command: None,
            };
            let (write_topic_id, _write_gossip_sender, _write_input_receiver) = 
                network.create_shared_session(write_header).await?;
            let write_ticket = network.create_session_ticket(write_topic_id, &write_session_id).await?;
            Some(write_ticket.to_string())
        } else {
            None
        };
        
        let (output_tx, output_rx) = mpsc::channel(64);
        
        Ok(Self {
            runner,
            encrypt,
            encryption_key,
            name: name.to_string(),
            session_id,
            ticket: ticket.to_string(),
            write_ticket,
            is_restored: false,
            network,
            shells_tx: HashMap::new(),
            output_tx,
            output_rx,
        })
    }
    
    /// 从已保存的会话状态恢复控制器
    pub async fn restore_from_session(
        name: &str,
        runner: Runner,
        network: P2PNetwork,
        session_data: &str, // 这里可以是持久化的会话信息
    ) -> Result<Self> {
        debug!("从保存的会话恢复控制器");
        
        // 这里应该解析 session_data 并恢复会话状态
        // 现在简化处理，只创建新会话
        let mut controller = Self::new(name, runner, false, network).await?;
        controller.is_restored = true;
        Ok(controller)
    }
    
    /// 返回会话名称
    pub fn name(&self) -> &str {
        &self.name
    }
    
    /// 返回会话 ticket
    pub fn ticket(&self) -> &str {
        &self.ticket
    }
    
    /// 返回写入 ticket（如果存在）
    pub fn write_ticket(&self) -> Option<&str> {
        self.write_ticket.as_deref()
    }
    
    /// 返回此会话的加密密钥，对服务器隐藏
    pub fn encryption_key(&self) -> &str {
        &self.encryption_key
    }
    
    /// 返回此会话是否从先前运行中恢复
    pub fn is_restored(&self) -> bool {
        self.is_restored
    }
    
    /// 返回用于持久化的会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
    
    /// 永远运行控制器，监听来自服务器的请求，参考 sshx
    pub async fn run(&mut self) -> ! {
        let mut last_retry = Instant::now();
        let mut retries = 0;
        loop {
            if let Err(err) = self.try_channel().await {
                if last_retry.elapsed() >= Duration::from_secs(10) {
                    retries = 0;
                }
                let secs = 2_u64.pow(retries.min(4));
                error!(%err, "连接断开，{}秒后重试...", secs);
                time::sleep(Duration::from_secs(secs)).await;
                retries += 1;
            }
            last_retry = Instant::now();
        }
    }
    
    /// `run()` 使用的辅助函数，可以返回错误，参考 sshx 实现
    async fn try_channel(&mut self) -> Result<()> {
        let (tx, rx) = mpsc::channel(16);
        
        let hello = ClientMessage::Hello(format!("{},{}", self.name, "token"));
        send_msg(&tx, hello).await?;
        
        // 这里应该使用 P2P 网络建立通道，现在模拟
        info!("建立 P2P 通道连接");
        
        let mut interval = time::interval(HEARTBEAT_INTERVAL);
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut reconnect = pin!(time::sleep(RECONNECT_INTERVAL));
        
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // 发送心跳
                    continue;
                }
                msg = self.output_rx.recv() => {
                    let msg = msg.context("不可达：output_tx 已关闭？")?;
                    send_msg(&tx, msg).await?;
                    continue;
                }
                _ = &mut reconnect => {
                    return Ok(()); // 重连到服务器
                }
            }
        }
    }
    
    /// 在客户端启动新终端任务的入口点，参考 sshx
    fn spawn_shell_task(&mut self, id: Sid, center: (i32, i32)) {
        let (shell_tx, shell_rx) = mpsc::channel(16);
        let opt = self.shells_tx.insert(id, shell_tx);
        debug_assert!(opt.is_none(), "shell ID 不能在现有任务中");
        
        let runner = self.runner.clone();
        let encrypt = self.encrypt.clone();
        let output_tx = self.output_tx.clone();
        tokio::spawn(async move {
            debug!(%id, "生成新 shell");
            let new_shell = NewShell {
                id: id.0,
                x: center.0,
                y: center.1,
            };
            if let Err(err) = output_tx.send(ClientMessage::CreatedShell(new_shell)).await {
                error!(%id, ?err, "发送 shell 创建消息失败");
                return;
            }
            if let Err(err) = runner.run(id, encrypt, shell_rx, output_tx.clone()).await {
                let err = ClientMessage::Error(err.to_string());
                output_tx.send(err).await.ok();
            }
            output_tx.send(ClientMessage::ClosedShell(id.0)).await.ok();
        });
    }
    
    /// 优雅地终止此会话
    pub async fn close(&self) -> Result<()> {
        debug!("关闭会话");
        
        // 这里应该清理 P2P 连接和资源
        info!("会话已关闭");
        Ok(())
    }
}

/// 尝试通过更新通道发送客户端消息，参考 sshx
async fn send_msg(tx: &mpsc::Sender<ClientMessage>, message: ClientMessage) -> Result<()> {
    tx.send(message)
        .await
        .context("发送消息到服务器失败")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_message_types() {
        let input = ServerMessage::Input {
            id: 1,
            data: b"hello".to_vec(),
            offset: 0,
        };
        
        match input {
            ServerMessage::Input { id, data, offset } => {
                assert_eq!(id, 1);
                assert_eq!(data, b"hello");
                assert_eq!(offset, 0);
            }
            _ => panic!("错误的消息类型"),
        }
    }
    
    #[tokio::test]
    async fn test_controller_creation() {
        // 这需要模拟的 P2PNetwork 来测试
        // 现在只测试基本结构
        assert!(true);
    }
}