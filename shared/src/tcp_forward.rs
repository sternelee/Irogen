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
        connections: Arc<Mutex<Vec<TcpForwardConnection>>>,
        connection_id: usize,
        config: TcpForwardConfig,
    ) -> Result<()> {
        info!("Starting to handle TCP connection {}", connection_id);

        // Take the TCP stream from connections (move instead of clone)
        let mut socket = {
            let mut conn_guard = connections.lock().await;
            if connection_id < conn_guard.len() {
                conn_guard.swap_remove(connection_id).local_stream
            } else {
                return Err(anyhow::anyhow!("Connection {} not found", connection_id));
            }
        };

        // Buffer for reading TCP data
        let mut buffer = [0; 8192];

        loop {
            match socket.read(&mut buffer).await {
                Ok(0) => {
                    // Connection closed
                    info!("TCP connection {} closed by client", connection_id);
                    break;
                }
                Ok(n) => {
                    // Read data from TCP connection
                    let data = buffer[..n].to_vec();
                    info!("Read {} bytes from TCP connection {}", n, connection_id);

                    // Send data through P2P network to remote client
                    if let Err(e) = config.network_sender.send(NetworkMessage::TcpForwardData {
                        from: todo!("Network layer should fill this"),
                        session_id: config.session_id.clone(),
                        remote_port: config.remote_port,
                        data: data.clone(),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                    }) {
                        error!("Failed to send TCP data through P2P network: {}", e);
                        break;
                    }

                    info!("Successfully forwarded {} bytes through P2P network", n);
                }
                Err(e) => {
                    error!("Error reading from TCP connection {}: {}", connection_id, e);
                    break;
                }
            }
        }

        // Notify that TCP forwarding stopped for this connection
        if let Err(e) = config.network_sender.send(NetworkMessage::TcpForwardStopped {
            from: todo!("Network layer should fill this"),
            session_id: config.session_id.clone(),
            remote_port: config.remote_port,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }) {
            error!("Failed to send TCP forward stopped notification: {}", e);
        }

        info!("TCP connection {} handling completed", connection_id);
        Ok(())
    }

    /// Forward received data to the TCP connections
    pub async fn forward_data(&self, data: &[u8]) -> Result<()> {
        info!("Forwarding {} bytes to {} TCP connections", data.len(), self.config.remote_port);

        let mut conn_guard = self.connections.lock().await;
        let mut connections_to_remove = Vec::new();

        for (i, connection) in conn_guard.iter_mut().enumerate() {
            match connection.local_stream.write_all(data).await {
                Ok(_) => {
                    // Data written successfully, try to flush
                    if let Err(e) = connection.local_stream.flush().await {
                        error!("Failed to flush TCP connection {}: {}", i, e);
                        connections_to_remove.push(i);
                    } else {
                        info!("Successfully forwarded {} bytes to TCP connection {}", data.len(), i);
                    }
                }
                Err(e) => {
                    error!("Failed to write to TCP connection {}: {}", i, e);
                    connections_to_remove.push(i);
                }
            }
        }

        // Remove failed connections (in reverse order to maintain indices)
        for &i in connections_to_remove.iter().rev() {
            conn_guard.remove(i);
            info!("Removed failed TCP connection {}", i);
        }

        if conn_guard.is_empty() {
            warn!("No active TCP connections to forward data to");
        }

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
    connections: Arc<Mutex<Vec<tokio::net::TcpStream>>>,
}

impl TcpForwardClient {
    pub fn new(local_port: u16, remote_port: u16) -> Self {
        Self {
            local_port,
            remote_port,
            connections: Arc::new(Mutex::new(Vec::new())),
        }
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
                    let connections = self.connections.clone();
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_client(socket, remote_port, connections).await {
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

    async fn handle_client(
        mut socket: tokio::net::TcpStream,
        remote_port: u16,
        connections: Arc<Mutex<Vec<tokio::net::TcpStream>>>,
    ) -> Result<()> {
        info!("Handling client connection for remote port {}", remote_port);

        // For the client side, we don't need to store the connection in a list
        // We'll handle each connection independently
        let connection_id = 0; // Placeholder for logging

        // Buffer for reading data from client
        let mut buffer = [0; 8192];

        loop {
            match socket.read(&mut buffer).await {
                Ok(0) => {
                    // Client closed connection
                    info!("Client connection {} closed", connection_id);
                    break;
                }
                Ok(n) => {
                    // Read data from client
                    let data = buffer[..n].to_vec();
                    info!("Read {} bytes from client connection {}", n, connection_id);

                    // TODO: Forward this data to the P2P network
                    // This would need to be connected to the P2P message system
                    info!("Client data ({} bytes) ready to be forwarded to P2P network", n);
                }
                Err(e) => {
                    error!("Error reading from client connection {}: {}", connection_id, e);
                    break;
                }
            }
        }

        info!("Client connection {} handling completed", connection_id);
        Ok(())
    }

    /// Forward received data to all connected TCP clients
    pub async fn forward_data(&self, data: &[u8]) -> Result<()> {
        info!("Forwarding {} bytes to {} TCP clients", data.len(), self.local_port);

        let mut conn_guard = self.connections.lock().await;
        let mut connections_to_remove = Vec::new();

        for (i, connection) in conn_guard.iter_mut().enumerate() {
            match connection.write_all(data).await {
                Ok(_) => {
                    // Data written successfully, try to flush
                    if let Err(e) = connection.flush().await {
                        error!("Failed to flush client connection {}: {}", i, e);
                        connections_to_remove.push(i);
                    } else {
                        info!("Successfully forwarded {} bytes to client connection {}", data.len(), i);
                    }
                }
                Err(e) => {
                    error!("Failed to write to client connection {}: {}", i, e);
                    connections_to_remove.push(i);
                }
            }
        }

        // Remove failed connections (in reverse order to maintain indices)
        for &i in connections_to_remove.iter().rev() {
            conn_guard.remove(i);
            info!("Removed failed client connection {}", i);
        }

        if conn_guard.is_empty() {
            warn!("No active TCP clients to forward data to");
        }

        Ok(())
    }
}