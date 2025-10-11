use anyhow::Result;
use crossterm::{
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// 本地WebShare管理器
#[derive(Debug)]
pub struct LocalWebShareManager {
    /// 活跃的WebShare代理
    proxies: Arc<RwLock<HashMap<u16, WebShareInfo>>>,
    /// 终端到端口的映射
    terminal_ports: Arc<RwLock<HashMap<String, Vec<u16>>>>,
}

#[derive(Debug, Clone)]
pub struct WebShareInfo {
    pub local_port: u16,
    pub public_port: u16,
    pub service_name: String,
    pub terminal_id: Option<String>,
    pub status: WebShareStatus,
    pub created_at: std::time::SystemTime,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WebShareStatus {
    Starting,
    Active,
    Error(String),
    Stopped,
}

impl LocalWebShareManager {
    pub fn new() -> Self {
        Self {
            proxies: Arc::new(RwLock::new(HashMap::new())),
            terminal_ports: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 列出所有活跃的WebShare
    pub async fn list_webshares(&self) -> Result<()> {
        println!("🌐 Active WebShares:");
        println!();

        let proxies = self.proxies.read().await;

        if proxies.is_empty() {
            println!("❌ No active WebShares found");
            return Ok(());
        }

        for (public_port, info) in proxies.iter() {
            let status_color = match info.status {
                WebShareStatus::Active => Color::Green,
                WebShareStatus::Starting => Color::Yellow,
                WebShareStatus::Error(_) => Color::Red,
                WebShareStatus::Stopped => Color::DarkGrey,
            };

            let status_text = match &info.status {
                WebShareStatus::Active => "🟢 Active",
                WebShareStatus::Starting => "🟡 Starting",
                WebShareStatus::Error(msg) => &format!("🔴 Error: {}", msg),
                WebShareStatus::Stopped => "⚫ Stopped",
            };

            let terminal_info = info
                .terminal_id
                .as_ref()
                .map(|id| format!(" (Terminal: {})", id))
                .unwrap_or_default();

            execute!(
                io::stdout(),
                SetForegroundColor(status_color),
                Print(format!(
                    "📡 Port {} → {} | {} | {}{}\n",
                    public_port, info.local_port, info.service_name, status_text, terminal_info
                )),
                ResetColor
            )?;
        }

        println!();
        println!("💡 Use --webshare <local_port>:<public_port> to create a new WebShare");

        Ok(())
    }

    /// 创建新的WebShare
    pub async fn create_webshare(
        &self,
        local_port: u16,
        public_port: u16,
        service_name: String,
        terminal_id: Option<String>,
    ) -> Result<()> {
        // 检查端口是否已被使用
        let proxies = self.proxies.read().await;
        if proxies.contains_key(&public_port) {
            return Err(anyhow::anyhow!(
                "Public port {} is already in use",
                public_port
            ));
        }
        drop(proxies);

        let info = WebShareInfo {
            local_port,
            public_port,
            service_name: service_name.clone(),
            terminal_id: terminal_id.clone(),
            status: WebShareStatus::Starting,
            created_at: std::time::SystemTime::now(),
        };

        // 添加到代理列表
        {
            let mut proxies = self.proxies.write().await;
            proxies.insert(public_port, info);
        }

        // 如果有关联的终端，添加到终端端口映射
        if let Some(ref term_id) = terminal_id {
            let mut terminal_ports = self.terminal_ports.write().await;
            terminal_ports
                .entry(term_id.clone())
                .or_insert_with(Vec::new)
                .push(public_port);
        }

        info!(
            "Created WebShare: {} → {} ({})",
            public_port, local_port, service_name
        );

        // TODO: 这里应该启动实际的代理服务器
        // 现在先标记为活跃状态
        self.update_webshare_status(public_port, WebShareStatus::Active)
            .await?;

        Ok(())
    }

    /// 停止WebShare
    pub async fn stop_webshare(&self, public_port: u16) -> Result<()> {
        let mut proxies = self.proxies.write().await;

        if let Some(info) = proxies.remove(&public_port) {
            // 从终端端口映射中移除
            if let Some(ref terminal_id) = info.terminal_id {
                let mut terminal_ports = self.terminal_ports.write().await;
                if let Some(ports) = terminal_ports.get_mut(terminal_id) {
                    ports.retain(|&p| p != public_port);
                    if ports.is_empty() {
                        terminal_ports.remove(terminal_id);
                    }
                }
            }

            info!(
                "Stopped WebShare on port {} ({})",
                public_port, info.service_name
            );

            // TODO: 这里应该停止实际的代理服务器

            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "WebShare on port {} not found",
                public_port
            ))
        }
    }

    /// 停止所有WebShare
    pub async fn stop_all_webshares(&self) -> Result<()> {
        let ports: Vec<u16> = self.proxies.read().await.keys().cloned().collect();

        for port in ports {
            self.stop_webshare(port).await?;
        }

        Ok(())
    }

    /// 停止特定终端的所有WebShare
    pub async fn stop_terminal_webshares(&self, terminal_id: &str) -> Result<()> {
        let ports_to_stop = {
            let terminal_ports = self.terminal_ports.read().await;
            terminal_ports.get(terminal_id).cloned().unwrap_or_default()
        };

        for port in ports_to_stop {
            self.stop_webshare(port).await?;
        }

        Ok(())
    }

    /// 更新WebShare状态
    pub async fn update_webshare_status(
        &self,
        public_port: u16,
        status: WebShareStatus,
    ) -> Result<()> {
        let mut proxies = self.proxies.write().await;

        if let Some(info) = proxies.get_mut(&public_port) {
            info.status = status;
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "WebShare on port {} not found",
                public_port
            ))
        }
    }

    /// 获取终端的所有WebShare
    pub async fn get_terminal_webshares(&self, terminal_id: &str) -> Vec<WebShareInfo> {
        let terminal_ports = self.terminal_ports.read().await;
        let proxies = self.proxies.read().await;

        if let Some(ports) = terminal_ports.get(terminal_id) {
            ports
                .iter()
                .filter_map(|&port| proxies.get(&port).cloned())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// 获取所有活跃的WebShare信息
    pub async fn get_active_webshares(&self) -> Vec<WebShareInfo> {
        self.proxies.read().await.values().cloned().collect()
    }

    /// 检查端口是否可用
    pub async fn is_port_available(&self, public_port: u16) -> bool {
        !self.proxies.read().await.contains_key(&public_port)
    }

    /// 查找可用的公共端口
    pub async fn find_available_port(&self, start_port: u16) -> Option<u16> {
        for port in start_port..=65535 {
            if self.is_port_available(port).await {
                return Some(port);
            }
        }
        None
    }

    /// 获取WebShare统计信息
    pub async fn get_stats(&self) -> WebShareStats {
        let proxies = self.proxies.read().await;
        let total = proxies.len();
        let active = proxies
            .values()
            .filter(|info| matches!(info.status, WebShareStatus::Active))
            .count();
        let errors = proxies
            .values()
            .filter(|info| matches!(info.status, WebShareStatus::Error(_)))
            .count();

        WebShareStats {
            total,
            active,
            errors,
            stopped: total - active - errors,
        }
    }
}

#[derive(Debug)]
pub struct WebShareStats {
    pub total: usize,
    pub active: usize,
    pub errors: usize,
    pub stopped: usize,
}

impl std::fmt::Display for WebShareStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Total: {}, Active: {}, Errors: {}, Stopped: {}",
            self.total, self.active, self.errors, self.stopped
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_webshare_creation_and_listing() {
        let manager = LocalWebShareManager::new();

        // 创建WebShare
        manager
            .create_webshare(
                3000,
                8080,
                "Test Service".to_string(),
                Some("terminal-1".to_string()),
            )
            .await
            .unwrap();

        // 列出WebShare
        manager.list_webshares().await.unwrap();

        // 获取统计信息
        let stats = manager.get_stats().await;
        assert_eq!(stats.total, 1);
        assert_eq!(stats.active, 1);
    }

    #[tokio::test]
    async fn test_terminal_webshare_mapping() {
        let manager = LocalWebShareManager::new();

        // 为终端创建多个WebShare
        manager
            .create_webshare(
                3000,
                8080,
                "Web Server".to_string(),
                Some("terminal-1".to_string()),
            )
            .await
            .unwrap();

        manager
            .create_webshare(
                5000,
                9090,
                "API Server".to_string(),
                Some("terminal-1".to_string()),
            )
            .await
            .unwrap();

        // 获取终端的WebShare
        let webshares = manager.get_terminal_webshares("terminal-1").await;
        assert_eq!(webshares.len(), 2);

        // 停止终端的所有WebShare
        manager.stop_terminal_webshares("terminal-1").await.unwrap();

        let webshares = manager.get_terminal_webshares("terminal-1").await;
        assert_eq!(webshares.len(), 0);
    }
}
