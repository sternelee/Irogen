//! 消息持久化存储（基于 JSONL）
//!
//! 此模块实现了轻量级的消息持久化方案，用于断线重连时的消息恢复。
//! 使用 JSON Lines (JSONL) 格式存储，每行一个 JSON 对象。
//!
//! # 设计原则
//! - 轻量：每行一个 JSON，追加写入，无需复杂索引
//! - 快速：顺序写入，顺序读取
//! - 有序：每条消息带有严格递增的 sequence 号
//! - 持久化：存储在 ~/.riterm/messages/ 目录下

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::RwLock;

/// 消息存储条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageStoreEntry {
    /// 消息序列号（严格递增）
    pub sequence: u64,
    /// 会话 ID
    pub session_id: String,
    /// 消息时间戳
    pub timestamp: u64,
    /// 消息数据（JSON 字符串）
    pub message_data: String,
}

/// 消息存储
///
/// 为每个 session_id 维护一个独立的 JSONL 文件。
pub struct MessageStore {
    /// 存储根目录
    base_dir: PathBuf,
    /// 当前每个 session 的最大 sequence 号（用于原子递增）
    sequence_counters: RwLock<std::collections::HashMap<String, AtomicU64>>,
}

impl MessageStore {
    /// 创建新的消息存储
    pub fn new(base_dir: PathBuf) -> Result<Self> {
        // 确保存储目录存在
        fs::create_dir_all(&base_dir)
            .with_context(|| format!("Failed to create message store directory: {:?}", base_dir))?;

        Ok(Self {
            base_dir,
            sequence_counters: RwLock::new(std::collections::HashMap::new()),
        })
    }

    /// 获取指定 session 的存储文件路径
    fn session_file_path(&self, session_id: &str) -> PathBuf {
        self.base_dir
            .join(format!("{}.jsonl", sanitize_session_id(session_id)))
    }

    /// 追加消息到存储
    ///
    /// 自动为消息分配递增的 sequence 号并写入 JSONL 文件。
    pub async fn append_message(
        &self,
        session_id: &str,
        message_data: &str,
    ) -> Result<u64> {
        // 获取或创建 sequence 计数器
        let sequence = {
            let mut counters = self.sequence_counters.write().await;

            // 从现有文件读取最大 sequence 号
            let initial_value = if let Ok(max_seq) = self.read_max_sequence(session_id).await {
                max_seq
            } else {
                0
            };

            counters
                .entry(session_id.to_string())
                .or_insert_with(|| AtomicU64::new(initial_value))
                .fetch_add(1, Ordering::SeqCst)
        };

        // 创建存储条目
        let entry = MessageStoreEntry {
            sequence,
            session_id: session_id.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            message_data: message_data.to_string(),
        };

        // 序列化为 JSON 行
        let json_line = serde_json::to_string(&entry)
            .with_context(|| "Failed to serialize message entry")?;

        // 追加到文件（使用 BufWriter 批量写入优化性能）
        let file_path = self.session_file_path(session_id);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .with_context(|| format!("Failed to open message store file: {:?}", file_path))?;

        use std::io::Write;
        writeln!(file, "{}", json_line)
            .with_context(|| "Failed to write message to store")?;

        tracing::debug!(
            "Appended message to store: session={}, seq={}, data_len={}",
            session_id,
            sequence,
            message_data.len()
        );

        Ok(sequence)
    }

    /// 读取自指定 sequence 之后的所有消息
    ///
    /// 用于断线重连时恢复缺失的消息。
    /// 如果 after_sequence 是 u64::MAX，返回所有消息。
    pub async fn get_messages_since(
        &self,
        session_id: &str,
        after_sequence: u64,
    ) -> Result<Vec<MessageStoreEntry>> {
        let file_path = self.session_file_path(session_id);

        // 检查文件是否存在
        if !file_path.exists() {
            return Ok(vec![]);
        }

        // 读取文件并解析每一行
        let content = fs::read_to_string(&file_path)
            .with_context(|| format!("Failed to read message store file: {:?}", file_path))?;

        let mut messages = Vec::new();

        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }

            // 解析 JSON 行
            if let Ok(entry) = serde_json::from_str::<MessageStoreEntry>(line) {
                // u64::MAX 是特殊值，表示获取所有消息
                // 否则只返回 sequence > after_sequence 的消息
                if after_sequence == u64::MAX || entry.sequence > after_sequence {
                    messages.push(entry);
                }
            } else {
                tracing::warn!("Failed to parse message entry: {}", line);
            }
        }

        tracing::debug!(
            "Retrieved {} messages from store: session={}, after_seq={}",
            messages.len(),
            session_id,
            after_sequence
        );

        Ok(messages)
    }

    /// 读取指定 session 的最大 sequence 号
    async fn read_max_sequence(&self, session_id: &str) -> Result<u64> {
        let file_path = self.session_file_path(session_id);

        if !file_path.exists() {
            return Ok(0);
        }

        // 读取文件最后一行（最大 sequence）
        let content = fs::read_to_string(&file_path)
            .with_context(|| format!("Failed to read message store file: {:?}", file_path))?;

        if let Some(last_line) = content.lines().last() {
            if let Ok(entry) = serde_json::from_str::<MessageStoreEntry>(last_line) {
                return Ok(entry.sequence);
            }
        }

        Ok(0)
    }

    /// 清理指定 session 的旧消息
    ///
    /// 删除整个 JSONL 文件。用于 session 结束时清理。
    pub async fn clear_session(&self, session_id: &str) -> Result<()> {
        let file_path = self.session_file_path(session_id);

        if file_path.exists() {
            fs::remove_file(&file_path)
                .with_context(|| format!("Failed to remove message store file: {:?}", file_path))?;

            tracing::info!("Cleared message store for session: {}", session_id);
        }

        // 重置 sequence 计数器
        let mut counters = self.sequence_counters.write().await;
        counters.remove(session_id);

        Ok(())
    }

    /// 获取存储的统计信息
    pub async fn get_stats(&self, session_id: &str) -> Result<MessageStoreStats> {
        let file_path = self.session_file_path(session_id);

        if !file_path.exists() {
            return Ok(MessageStoreStats::default());
        }

        let content = fs::read_to_string(&file_path)
            .with_context(|| format!("Failed to read message store file: {:?}", file_path))?;

        let mut total_messages = 0;
        let mut max_sequence = 0u64;
        let mut total_size = 0;

        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }

            total_messages += 1;
            total_size += line.len();

            if let Ok(entry) = serde_json::from_str::<MessageStoreEntry>(line) {
                if entry.sequence > max_sequence {
                    max_sequence = entry.sequence;
                }
            }
        }

        Ok(MessageStoreStats {
            total_messages,
            max_sequence,
            total_bytes: total_size,
        })
    }
}

/// 消息存储统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessageStoreStats {
    pub total_messages: usize,
    pub max_sequence: u64,
    pub total_bytes: usize,
}

/// 清理 session_id 中的特殊字符，使其可以作为文件名
fn sanitize_session_id(session_id: &str) -> String {
    session_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_append_and_retrieve() {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().to_path_buf();

        let store = MessageStore::new(base_dir.clone()).unwrap();

        // 追加三条消息
        let session_id = "test-session";
        let seq1 = store.append_message(session_id, "msg1").await.unwrap();
        let seq2 = store.append_message(session_id, "msg2").await.unwrap();
        let seq3 = store.append_message(session_id, "msg3").await.unwrap();

        // 验证 sequence 严格递增 (fetch_add returns old value)
        // So first call returns 0, second returns 1, third returns 2
        assert_eq!(seq1, 0);
        assert_eq!(seq2, 1);
        assert_eq!(seq3, 2);

        // 读取自 seq 1 之后的消息 (sequence > 1)
        // Should return only seq 2
        let messages = store
            .get_messages_since(session_id, 1)
            .await
            .unwrap();

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].sequence, 2);
        assert_eq!(messages[0].message_data, "msg3");

        // 读取自 seq 0 之后的消息 (sequence > 0)
        // Should return seq 1 and seq 2
        let messages = store
            .get_messages_since(session_id, 0)
            .await
            .unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].sequence, 1);
        assert_eq!(messages[1].sequence, 2);
    }

    #[tokio::test]
    async fn test_session_isolation() {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().to_path_buf();

        let store = MessageStore::new(base_dir.clone()).unwrap();

        // 两个不同的 session
        let session1 = "session-1";
        let session2 = "session-2";

        // Each session starts with sequence 0
        let seq1_s1 = store.append_message(session1, "msg1").await.unwrap();
        let seq1_s2 = store.append_message(session2, "msg1").await.unwrap();
        let seq2_s1 = store.append_message(session1, "msg2").await.unwrap();
        let seq2_s2 = store.append_message(session2, "msg2").await.unwrap();

        // 验证 sequence 独立
        assert_eq!(seq1_s1, 0);
        assert_eq!(seq1_s2, 0);
        assert_eq!(seq2_s1, 1);
        assert_eq!(seq2_s2, 1);

        // 读取所有消息 (sequence > 0, i.e., second message in each session)
        let messages1 = store.get_messages_since(session1, 0).await.unwrap();
        let messages2 = store.get_messages_since(session2, 0).await.unwrap();

        // Should only have the second message (seq 1) in each session
        assert_eq!(messages1.len(), 1);
        assert_eq!(messages2.len(), 1);
        assert_eq!(messages1[0].message_data, "msg2");
        assert_eq!(messages2[0].message_data, "msg2");
    }

    #[tokio::test]
    async fn test_clear_session() {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().to_path_buf();

        let store = MessageStore::new(base_dir.clone()).unwrap();

        let session_id = "test-session";
        store.append_message(session_id, "msg1").await.unwrap();
        store.append_message(session_id, "msg2").await.unwrap();

        // 清理 session
        store.clear_session(session_id).await.unwrap();

        // 验证文件已删除
        let file_path = base_dir.join(format!("{}.jsonl", sanitize_session_id(session_id)));
        assert!(!file_path.exists());

        // 重新添加消息应该从 sequence 0 开始
        let seq = store.append_message(session_id, "msg3").await.unwrap();
        assert_eq!(seq, 0);
    }
}
