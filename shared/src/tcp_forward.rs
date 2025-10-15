use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};

use crate::p2p::NetworkMessage;
use iroh::NodeId;

/// TCP forwarding configuration
#[derive(Debug, Clone)]
pub struct TcpForwardConfig {
    pub local_port: u16,
    pub remote_port: u16,
    pub service_name: String,
    pub session_id: String,
    pub network_sender: mpsc::UnboundedSender<NetworkMessage>,
}

/// Active TCP forwarding connection
#[derive(Debug)]
pub struct TcpForwardConnection {
    pub remote_port: u16,
    pub local_stream: tokio::net::TcpStream,
    pub remote_node_id: NodeId,
}

/// TCP forwarding manager (like dumbpipe listen-tcp)
pub struct TcpForwardManager {
    connections: Arc<Mutex<Vec<TcpForwardConnection>>>,
    config: TcpForwardConfig,
}

impl TcpForwardManager {
    pub fn new(config: TcpForwardConfig) -> Self {
        Self {
            connections: Arc::new(Mutex::new(Vec::new())),
            config,
        }
    }

    /// Start TCP forwarding server (like dumbpipe listen-tcp)
    pub async fn start(&self) -> Result<()> {
        info!("Starting TCP forward from {} to remote port {}",
              self.config.local_port, self.config.remote_port);

        let addr = format!("127.0.0.1:{}", self.config.local_port);
        let listener = TcpListener::bind(&addr).await
            .map_err(|e| anyhow::anyhow!("Failed to bind to {}: {}", addr, e))?;

        info!("TCP forward server listening on {}", addr);

        // Notify that TCP forwarding is ready
        if let Err(_e) = self.config.network_sender.send(NetworkMessage::TcpForwardConnected {
            from: todo!("Network layer should fill this"),
            session_id: self.config.session_id.clone(),
            remote_port: self.config.remote_port,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }) {
            error!("Failed to send TCP forward connected notification: {}", _e);
        }

        let connections = self.connections.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((socket, addr)) => {
                        info!("New TCP connection from {}", addr);

                        let mut conn_guard = connections.lock().await;
                        let connection_id = conn_guard.len();
                        conn_guard.push(TcpForwardConnection {
                            remote_port: config.remote_port,
                            local_stream: socket,
                            remote_node_id: todo!("Network layer should fill this"),
                        });
                        drop(conn_guard);

                        // Handle this connection in a separate task
                        let connections_clone = connections.clone();
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_connection(
                                connections_clone,
                                connection_id,
                                config.clone(),
                            ).await {
                                error!("Error handling TCP connection {}: {}", addr, e);
                            }
                        });
                    }
                    Err(e) => {
                        warn!("Error accepting TCP connection: {}", e);
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    /// Handle a single TCP connection and forward data via P2P
    async fn handle_connection(
        _connections: Arc<Mutex<Vec<TcpForwardConnection>>>,
        _connection_id: usize,
        _config: TcpForwardConfig,
    ) -> Result<()> {
        // Simplified implementation - just log the connection
        info!("Handling TCP connection (simplified implementation)");
        Ok(())
    }

    /// Forward received data to the TCP connections
    pub async fn forward_data(&self, data: &[u8]) -> Result<()> {
        // TODO: Implement actual data forwarding to TCP connections
        // For now, just log the received data
        info!("Forwarding {} bytes to TCP connections", data.len());
        Ok(())
    }

    /// Stop all TCP connections
    pub async fn stop(&self) -> Result<()> {
        info!("Stopping TCP forwarding server");
        let _connections = self.connections.lock().await;
        // Connections will be cleaned up automatically when the manager is dropped
        Ok(())
    }
}

/// TCP client for receiving forwarded data (like dumbpipe connect-tcp)
pub struct TcpForwardClient {
    local_port: u16,
    remote_port: u16,
}

impl TcpForwardClient {
    pub fn new(local_port: u16, remote_port: u16) -> Self {
        Self { local_port, remote_port }
    }

    /// Start listening for forwarded data and serve it locally
    pub async fn start(&self) -> Result<()> {
        info!("Starting TCP forward client on port {}", self.local_port);

        let addr = format!("0.0.0.0:{}", self.local_port);
        let listener = TcpListener::bind(&addr).await
            .map_err(|e| anyhow::anyhow!("Failed to bind to {}: {}", addr, e))?;

        info!("TCP forward client listening on {}", addr);

        loop {
            match listener.accept().await {
                Ok((socket, addr)) => {
                    info!("New client connection from {}", addr);
                    // Handle each client connection
                    let remote_port = self.remote_port;
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_client(socket, remote_port).await {
                            error!("Error handling client {}: {}", addr, e);
                        }
                    });
                }
                Err(e) => {
                    warn!("Error accepting client connection: {}", e);
                    break Ok(());
                }
            }
        }
    }

    async fn handle_client(mut socket: tokio::net::TcpStream, remote_port: u16) -> Result<()> {
        // For now, just send a simple response
        let response = format!("Hello from TCP forward client! Remote port: {}\n", remote_port);
        socket.write_all(response.as_bytes()).await?;
        socket.flush().await?;
        Ok(())
    }

    /// Forward received data to the TCP connection
    pub async fn forward_data(&self, data: &[u8]) -> Result<()> {
        // TODO: Implement actual data forwarding to TCP connections
        // For now, just log the received data
        info!("Forwarding {} bytes to TCP connections", data.len());
        Ok(())
    }
}