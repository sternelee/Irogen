//! 消息同步服务（CLI Host 端）
//!
//! 此模块实现了消息同步功能，用于处理 App 端的断线重连请求。
//!
//! # 核心功能
//! - 维护每个 session 的最后已发送 sequence 号
//! - 处理 App 端发来的同步请求（请求自指定 sequence 之后的消息）
//! - 使用 MessageStore 读取并重放历史消息

use anyhow::{Context, Result};
use crate::message_store::MessageStore;
use super::message_protocol::{
    AgentMessageContent, AgentMessageMessage, Message, MessageBuilder, MessagePayload,
    MessageSyncAction, SynchedMessageEntry,
};
use super::message_store::MessageStoreEntry;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};

/// 消息同步服务
pub struct MessageSyncService {
    /// 消息存储
    message_store: Arc<MessageStore>,
    /// 每个 session 的最后发送 sequence 号
    last_sequences: Arc<tokio::sync::RwLock<HashMap<String, u64>>>,
}

impl MessageSyncService {
    /// 创建新的消息同步服务
    pub fn new(message_store: Arc<MessageStore>) -> Self {
        Self {
            message_store,
            last_sequences: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
        }
    }

    /// 处理 Agent 消息并持久化
    ///
    /// 在将消息发送给 App 端之前，先保存到 MessageStore。
    pub async fn persist_agent_message(
        &self,
        session_id: &str,
        message: &AgentMessageMessage,
    ) -> Result<()> {
        // 序列化消息数据
        let message_data = serde_json::to_string(message)
            .context("Failed to serialize agent message")?;

        // 追加到存储
        let _sequence = self
            .message_store
            .append_message(session_id, &message_data)
            .await?;

        // 更新最后发送的 sequence 号
        let mut last_seqs = self.last_sequences.write().await;
        last_seqs.insert(session_id.to_string(), _sequence);

        debug!(
            "Persisted agent message: session={}, seq={}, type={:?}",
            session_id,
            _sequence,
            message.content
        );

        Ok(())
    }

    /// 处理 App 端发来的同步请求
    ///
    /// 读取自指定 sequence 之后的所有消息并返回给 App。
    pub async fn handle_sync_request(
        &self,
        request_session_id: &str,
        request_last_sequence: u64,
    ) -> Result<Message> {
        info!(
            "Received sync request: session={}, last_seq={}",
            request_session_id,
            request_last_sequence
        );

        // 从存储读取缺失的消息
        let messages: Vec<MessageStoreEntry> = self
            .message_store
            .get_messages_since(request_session_id, request_last_sequence)
            .await?;

        if messages.is_empty() {
            debug!("No missing messages to sync");
        } else {
            info!(
                "Syncing {} messages: session={}, from_seq={}",
                messages.len(),
                request_session_id,
                request_last_sequence
            );
        }

        // 转换为同步响应格式
        let synced_entries: Vec<SynchedMessageEntry> = messages
            .into_iter()
            .map(|entry| SynchedMessageEntry {
                sequence: entry.sequence,
                timestamp: entry.timestamp,
                message_data: entry.message_data,
            })
            .collect();

        // 创建同步响应消息
        let response = MessageBuilder::sync_response(
            "cli_host".to_string(),
            request_session_id.to_string(),
            synced_entries,
        );

        Ok(response)
    }

    /// 获取指定 session 的最后发送 sequence 号
    pub async fn get_last_sequence(&self, session_id: &str) -> Option<u64> {
        let last_seqs = self.last_sequences.read().await;
        last_seqs.get(session_id).copied()
    }

    /// 清理指定 session 的同步状态
    ///
    /// 当 session 结束时调用，清理相关的 sequence 记录。
    pub async fn clear_session(&self, session_id: &str) -> Result<()> {
        // 清理存储中的 session 数据
        self.message_store.clear_session(session_id).await?;

        // 清理最后 sequence 记录
        let mut last_seqs = self.last_sequences.write().await;
        last_seqs.remove(session_id);

        info!("Cleared sync state for session: {}", session_id);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_persist_and_retrieve() {
        let temp_dir = tempfile::tempdir().unwrap();
        let message_store = Arc::new(MessageStore::new(temp_dir.path().to_path_buf()).unwrap());
        let sync_service = MessageSyncService::new(message_store.clone());

        let session_id = "test-session";

        // 创建测试消息
        let message = AgentMessageMessage {
            session_id: session_id.to_string(),
            content: AgentMessageContent::TextDelta {
                text: "Hello".to_string(),
                thinking: false,
            },
            sequence: None,
        };

        // 持久化消息
        sync_service.persist_agent_message(session_id, &message).await.unwrap();

        // 验证最后 sequence 号
        let last_seq = sync_service.get_last_sequence(session_id).await;
        assert_eq!(last_seq, Some(0));

        // 测试同步请求 - u64::MAX 表示获取所有消息
        let sync_response = sync_service
            .handle_sync_request(session_id, u64::MAX)
            .await
            .unwrap();

        // 验证响应
        if let MessagePayload::MessageSync(sync_msg) = &sync_response.payload {
            if let MessageSyncAction::SyncResponse { messages, .. } = &sync_msg.action {
                assert_eq!(messages.len(), 1);
                assert_eq!(messages[0].sequence, 0);
            }
        }
    }

    #[tokio::test]
    async fn test_sync_with_partial_history() {
        let temp_dir = tempfile::tempdir().unwrap();
        let message_store = Arc::new(MessageStore::new(temp_dir.path().to_path_buf()).unwrap());
        let sync_service = MessageSyncService::new(message_store.clone());

        let session_id = "test-session";

        // 添加三条消息 (sequences 0, 1, 2)
        for i in 0..3 {
            let message = AgentMessageMessage {
                session_id: session_id.to_string(),
                content: AgentMessageContent::TextDelta {
                    text: format!("Message {}", i),
                    thinking: false,
                },
                sequence: None,
            };
            sync_service.persist_agent_message(session_id, &message).await.unwrap();
        }

        // 同步从 seq 1 之后的消息（返回 sequence > 1 的消息，即 seq 2）
        let sync_response = sync_service
            .handle_sync_request(session_id, 1)
            .await
            .unwrap();

        if let MessagePayload::MessageSync(sync_msg) = &sync_response.payload {
            if let MessageSyncAction::SyncResponse { messages, .. } = &sync_msg.action {
                assert_eq!(messages.len(), 1);
                assert_eq!(messages[0].sequence, 2);
            }
        }
    }

    #[tokio::test]
    async fn test_clear_session() {
        let temp_dir = tempfile::tempdir().unwrap();
        let message_store = Arc::new(MessageStore::new(temp_dir.path().to_path_buf()).unwrap());
        let sync_service = MessageSyncService::new(message_store.clone());

        let session_id = "test-session";

        // 添加消息
        let message = AgentMessageMessage {
            session_id: session_id.to_string(),
            content: AgentMessageContent::TextDelta {
                text: "Test".to_string(),
                thinking: false,
            },
            sequence: None,
        };
        sync_service.persist_agent_message(session_id, &message).await.unwrap();

        // 清理 session
        sync_service.clear_session(session_id).await.unwrap();

        // 验证清理成功
        let last_seq = sync_service.get_last_sequence(session_id).await;
        assert_eq!(last_seq, None);
    }
}
