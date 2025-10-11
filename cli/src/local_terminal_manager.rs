use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::local_webshare::LocalWebShareManager;
use crate::shell::ShellDetector;
use riterm_shared::p2p::{
    GossipSender, P2PNetwork, TerminalInfo, TerminalStats, TerminalStatus, WebShareInfo,
    WebShareStats, WebShareStatus,
};


/// 本地终端会话信息
#[derive(Debug, Clone)]
pub struct LocalTerminalInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub status: TerminalStatus,
    pub created_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
    pub size: (u16, u16), // (rows, cols)
    pub process_id: Option<u32>,
    pub associated_webshares: Vec<u16>,
}

impl From<LocalTerminalInfo> for TerminalInfo {
    fn from(local: LocalTerminalInfo) -> Self {
        Self {
            id: local.id,
            name: local.name,
            shell_type: local.shell_type,
            current_dir: local.current_dir,
            status: local.status,
            created_at: local
                .created_at
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            last_activity: local
                .last_activity
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            size: local.size,
            process_id: local.process_id,
            associated_webshares: local.associated_webshares,
        }
    }
}

impl From<crate::local_webshare::WebShareInfo> for WebShareInfo {
    fn from(local: crate::local_webshare::WebShareInfo) -> Self {
        Self {
            local_port: local.local_port,
            public_port: local.public_port,
            service_name: local.service_name,
            terminal_id: local.terminal_id,
            status: match local.status {
                crate::local_webshare::WebShareStatus::Starting => WebShareStatus::Starting,
                crate::local_webshare::WebShareStatus::Active => WebShareStatus::Active,
                crate::local_webshare::WebShareStatus::Error(msg) => WebShareStatus::Error(msg),
                crate::local_webshare::WebShareStatus::Stopped => WebShareStatus::Stopped,
            },
            created_at: local
                .created_at
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }
}

impl From<crate::local_webshare::WebShareStats> for WebShareStats {
    fn from(local: crate::local_webshare::WebShareStats) -> Self {
        Self {
            total: local.total,
            active: local.active,
            errors: local.errors,
            stopped: local.stopped,
        }
    }
}

/// 本地终端管理器
pub struct LocalTerminalManager {
    /// 终端会话存储
    terminals: Arc<RwLock<HashMap<String, LocalTerminalInfo>>>,
    /// WebShare管理器
    webshare_manager: Arc<LocalWebShareManager>,
    /// 终端事件发送器
    event_sender: Arc<mpsc::UnboundedSender<TerminalEvent>>,
    /// 终端事件接收器
    event_receiver: Arc<RwLock<Option<mpsc::UnboundedReceiver<TerminalEvent>>>>,
    /// P2P网络
    p2p_network: Option<P2PNetwork>,
    /// 当前会话ID
    current_session_id: Arc<RwLock<Option<String>>>,
    /// Gossip发送器
    gossip_sender: Arc<RwLock<Option<GossipSender>>>,
}

impl Clone for LocalTerminalManager {
    fn clone(&self) -> Self {
        Self {
            terminals: Arc::clone(&self.terminals),
            webshare_manager: Arc::clone(&self.webshare_manager),
            event_sender: Arc::clone(&self.event_sender),
            event_receiver: Arc::clone(&self.event_receiver),
            p2p_network: self.p2p_network.clone(),
            current_session_id: Arc::clone(&self.current_session_id),
            gossip_sender: Arc::clone(&self.gossip_sender),
        }
    }
}

#[derive(Debug, Clone)]
pub enum TerminalEvent {
    Created { id: String },
    StatusChanged { id: String, status: TerminalStatus },
    Stopped { id: String },
}

impl LocalTerminalManager {
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::unbounded_channel();

        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            webshare_manager: Arc::new(LocalWebShareManager::new()),
            event_sender: Arc::new(event_sender),
            event_receiver: Arc::new(RwLock::new(Some(event_receiver))),
            p2p_network: None,
            current_session_id: Arc::new(RwLock::new(None)),
            gossip_sender: Arc::new(RwLock::new(None)),
        }
    }

    /// 设置P2P网络和会话信息
    pub async fn set_p2p_session(
        &mut self,
        network: P2PNetwork,
        session_id: String,
        sender: GossipSender,
    ) {
        self.p2p_network = Some(network.clone());
        *self.current_session_id.write().await = Some(session_id.clone());
        *self.gossip_sender.write().await = Some(sender.clone());

        // 启动P2P消息处理
        self.start_p2p_message_handler(network, session_id, sender)
            .await;
    }

    /// 启动P2P消息处理器
    async fn start_p2p_message_handler(
        &self,
        network: P2PNetwork,
        session_id: String,
        sender: GossipSender,
    ) {
        let terminal_manager = self.clone();
        let event_receiver = {
            let mut receiver_guard = self.event_receiver.write().await;
            receiver_guard.take().expect("Event receiver already taken")
        };

        tokio::spawn(async move {
            debug!("Starting P2P message handler for terminal management");

            // 监听本地终端事件并广播到P2P网络
            let mut event_receiver = event_receiver;
            let manager_clone = terminal_manager.clone();
            let network_clone = network.clone();
            let session_id_clone = session_id.clone();
            let sender_clone = sender.clone();

            tokio::spawn(async move {
                while let Some(event) = event_receiver.recv().await {
                    if let Err(e) = manager_clone
                        .handle_terminal_event(
                            &event,
                            &network_clone,
                            &session_id_clone,
                            &sender_clone,
                        )
                        .await
                    {
                        error!("Failed to handle terminal event: {}", e);
                    }
                }
            });

            debug!("P2P message handler started");
        });
    }

    /// 处理终端事件并广播到P2P网络
    async fn handle_terminal_event(
        &self,
        event: &TerminalEvent,
        network: &P2PNetwork,
        session_id: &str,
        sender: &GossipSender,
    ) -> Result<()> {
        match event {
            TerminalEvent::Created { id } => {
                // 广播终端状态更新
                if let Some(info) = self.get_terminal_info(id).await {
                    network
                        .send_terminal_status_update(session_id, sender, id.clone(), info.status)
                        .await?;
                }
            }
            TerminalEvent::StatusChanged { id, status } => {
                // 广播状态变化
                network
                    .send_terminal_status_update(session_id, sender, id.clone(), status.clone())
                    .await?;
            }
            TerminalEvent::Stopped { id } => {
                // 广播停止事件
                network
                    .send_terminal_stop(session_id, sender, id.clone())
                    .await?;
            }
        }
        Ok(())
    }

    /// 处理来自P2P网络的终端管理请求
    pub async fn handle_p2p_request(
        &self,
        request: &riterm_shared::p2p::TerminalMessageBody,
        network: &P2PNetwork,
        session_id: &str,
        sender: &GossipSender,
    ) -> Result<()> {
        match request {
            riterm_shared::p2p::TerminalMessageBody::TerminalCreate {
                name,
                shell_path,
                working_dir,
                size,
                ..
            } => {
                let terminal_id = self
                    .create_terminal(name.clone(), shell_path.clone(), working_dir.clone(), *size)
                    .await?;
                info!("Created terminal {} via P2P request", terminal_id);
            }
            riterm_shared::p2p::TerminalMessageBody::TerminalStop { terminal_id, .. } => {
                self.stop_terminal(terminal_id).await?;
                info!("Stopped terminal {} via P2P request", terminal_id);
            }
            riterm_shared::p2p::TerminalMessageBody::TerminalListRequest { .. } => {
                let terminals: Vec<TerminalInfo> = self
                    .get_all_terminals()
                    .await
                    .into_iter()
                    .map(Into::into)
                    .collect();
                network
                    .send_terminal_list_response(session_id, sender, terminals)
                    .await?;
            }
            riterm_shared::p2p::TerminalMessageBody::WebShareCreate {
                local_port,
                public_port,
                service_name,
                terminal_id,
                ..
            } => {
                let public_port = self
                    .create_terminal_webshare(
                        terminal_id.as_ref().unwrap_or(&"".to_string()),
                        *local_port,
                        *public_port,
                        service_name.clone(),
                    )
                    .await?;
                info!(
                    "Created WebShare {} -> {} via P2P request",
                    public_port, local_port
                );
            }
            riterm_shared::p2p::TerminalMessageBody::WebShareStop { public_port, .. } => {
                self.webshare_manager.stop_webshare(*public_port).await?;
                info!("Stopped WebShare {} via P2P request", public_port);
            }
            riterm_shared::p2p::TerminalMessageBody::WebShareListRequest { .. } => {
                let webshares: Vec<WebShareInfo> = self
                    .webshare_manager
                    .get_active_webshares()
                    .await
                    .into_iter()
                    .map(Into::into)
                    .collect();
                network
                    .send_webshare_list_response(session_id, sender, webshares)
                    .await?;
            }
            riterm_shared::p2p::TerminalMessageBody::StatsRequest { .. } => {
                let terminal_stats = self.get_stats().await;
                let webshare_stats: WebShareStats = self.webshare_manager.get_stats().await.into();
                network
                    .send_stats_response(session_id, sender, terminal_stats, webshare_stats)
                    .await?;
            }
            _ => {
                debug!("Unhandled P2P message type: {:?}", request);
            }
        }
        Ok(())
    }

    /// 创建新的本地终端会话
    pub async fn create_terminal(
        &self,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<String> {
        let terminal_id = Uuid::new_v4().to_string();

        // 检测或使用指定的shell
        let shell_type = if let Some(shell) = shell_path {
            shell
        } else {
            ShellDetector::get_default_shell()
                .get_command_path()
                .to_string()
        };

        // 获取当前工作目录
        let current_dir = working_dir.unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("/"))
                .to_string_lossy()
                .to_string()
        });

        let terminal_info = LocalTerminalInfo {
            id: terminal_id.clone(),
            name: name.clone(),
            shell_type: shell_type.clone(),
            current_dir: current_dir.clone(),
            status: TerminalStatus::Starting,
            created_at: std::time::SystemTime::now(),
            last_activity: std::time::SystemTime::now(),
            size: size.unwrap_or((24, 80)),
            process_id: None,
            associated_webshares: Vec::new(),
        };

        // 添加到终端列表
        {
            let mut terminals = self.terminals.write().await;
            terminals.insert(terminal_id.clone(), terminal_info);
        }

        info!(
            "Created terminal '{}' ({})",
            name.as_deref().unwrap_or(&terminal_id),
            terminal_id
        );

        // 发送创建事件
        let _ = self.event_sender.send(TerminalEvent::Created {
            id: terminal_id.clone(),
        });

        // TODO: 这里应该启动实际的终端进程
        // 现在先模拟启动成功
        self.update_terminal_status(&terminal_id, TerminalStatus::Running)
            .await?;

        Ok(terminal_id)
    }

    /// 停止终端会话
    pub async fn stop_terminal(&self, terminal_id: &str) -> Result<()> {
        info!("Stopping terminal: {}", terminal_id);

        // 先停止相关的WebShare
        self.webshare_manager
            .stop_terminal_webshares(terminal_id)
            .await?;

        // 更新终端状态
        self.update_terminal_status(terminal_id, TerminalStatus::Stopped)
            .await?;

        // 发送停止事件
        let _ = self.event_sender.send(TerminalEvent::Stopped {
            id: terminal_id.to_string(),
        });

        // TODO: 这里应该停止实际的终端进程

        // 从终端列表中移除
        {
            let mut terminals = self.terminals.write().await;
            terminals.remove(terminal_id);
        }

        Ok(())
    }

    /// 停止所有终端
    pub async fn stop_all_terminals(&self) -> Result<()> {
        let terminal_ids: Vec<String> = self.terminals.read().await.keys().cloned().collect();

        for id in terminal_ids {
            self.stop_terminal(&id).await?;
        }

        Ok(())
    }

    /// 更新终端状态
    pub async fn update_terminal_status(
        &self,
        terminal_id: &str,
        status: TerminalStatus,
    ) -> Result<()> {
        let mut terminals = self.terminals.write().await;

        if let Some(info) = terminals.get_mut(terminal_id) {
            info.status = status.clone();
            info.last_activity = std::time::SystemTime::now();

            // 发送状态变化事件
            let _ = self.event_sender.send(TerminalEvent::StatusChanged {
                id: terminal_id.to_string(),
                status,
            });

            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal {} not found", terminal_id))
        }
    }

    /// 获取终端信息
    pub async fn get_terminal_info(&self, terminal_id: &str) -> Option<LocalTerminalInfo> {
        self.terminals.read().await.get(terminal_id).cloned()
    }

    /// 获取所有终端信息
    pub async fn get_all_terminals(&self) -> Vec<LocalTerminalInfo> {
        self.terminals.read().await.values().cloned().collect()
    }

    /// 为终端创建WebShare
    pub async fn create_terminal_webshare(
        &self,
        terminal_id: &str,
        local_port: u16,
        public_port: Option<u16>,
        service_name: String,
    ) -> Result<u16> {
        // 验证终端存在
        if !self.terminals.read().await.contains_key(terminal_id) {
            return Err(anyhow::anyhow!("Terminal {} not found", terminal_id));
        }

        // 查找可用的公共端口
        let public_port = if let Some(port) = public_port {
            if !self.webshare_manager.is_port_available(port).await {
                return Err(anyhow::anyhow!("Public port {} is already in use", port));
            }
            port
        } else {
            self.webshare_manager
                .find_available_port(8080)
                .await
                .ok_or_else(|| anyhow::anyhow!("No available ports found"))?
        };

        // 创建WebShare
        self.webshare_manager
            .create_webshare(
                local_port,
                public_port,
                service_name,
                Some(terminal_id.to_string()),
            )
            .await?;

        // 更新终端的WebShare列表
        {
            let mut terminals = self.terminals.write().await;
            if let Some(info) = terminals.get_mut(terminal_id) {
                info.associated_webshares.push(public_port);
            }
        }

        info!(
            "Created WebShare for terminal {}: {} → {}",
            terminal_id, public_port, local_port
        );

        Ok(public_port)
    }

    /// 获取WebShare管理器的引用
    pub fn webshare_manager(&self) -> &LocalWebShareManager {
        &self.webshare_manager
    }

    /// 获取终端统计信息
    pub async fn get_stats(&self) -> TerminalStats {
        let terminals = self.terminals.read().await;
        let total = terminals.len();
        let running = terminals
            .values()
            .filter(|info| info.status == TerminalStatus::Running)
            .count();
        let errors = terminals
            .values()
            .filter(|info| matches!(info.status, TerminalStatus::Error(_)))
            .count();

        TerminalStats {
            total,
            running,
            errors,
            stopped: total - running - errors,
        }
    }
}
