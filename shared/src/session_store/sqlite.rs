//! SQLite-backed session store implementation

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use rusqlite::{Connection, params};
use tokio::sync::Mutex;
use tracing::{debug, info};

use super::{ChatMessage, SessionFilter, SessionRecord, SessionStatus, SessionStore};

/// SQLite session store
pub struct SqliteSessionStore {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl SqliteSessionStore {
    /// Create a new SQLite session store
    ///
    /// Database will be created at `{data_dir}/memory/sessions.db`
    pub fn new(data_dir: &PathBuf) -> anyhow::Result<Self> {
        let db_path = data_dir.join("memory").join("sessions.db");

        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        Self::init_schema(&conn)?;

        info!("Session store initialized at: {:?}", db_path);

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        })
    }

    /// Initialize database schema
    fn init_schema(conn: &Connection) -> anyhow::Result<()> {
        conn.execute_batch(
            r#"
            -- Sessions table
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                agent_type TEXT NOT NULL,
                project_path TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                hostname TEXT NOT NULL,
                os TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Messages table
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                is_user INTEGER NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                attachments TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );

            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_sequence ON messages(session_id, sequence);
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_sessions_agent_type ON sessions(agent_type);
            CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
            "#,
        )?;

        Ok(())
    }

    /// Get database path
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }
}

#[async_trait]
impl SessionStore for SqliteSessionStore {
    async fn save_session(&self, record: &SessionRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;

        conn.execute(
            r#"
            INSERT INTO sessions (
                session_id, agent_type, project_path, started_at, last_active_at,
                status, hostname, os, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                record.session_id,
                serde_json::to_string(&record.agent_type)?,
                record.project_path,
                record.started_at,
                record.last_active_at,
                record.status.to_string(),
                record.hostname,
                record.os,
                record.metadata_json,
            ],
        )?;

        // Save all messages
        for msg in &record.messages {
            self.add_message(&record.session_id, msg).await?;
        }

        debug!("Saved session: {}", record.session_id);
        Ok(())
    }

    async fn load_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        let session_id_owned = session_id.to_string();

        // First get the session data
        let rec = {
            let conn = self.conn.lock().await;

            let mut stmt = conn.prepare(
                r#"
                SELECT session_id, agent_type, project_path, started_at, last_active_at,
                       status, hostname, os, metadata_json
                FROM sessions
                WHERE session_id = ?1
                "#,
            )?;

            let record = stmt.query_row(params![session_id], |row| {
                let agent_type_str: String = row.get(1)?;
                let status_str: String = row.get(5)?;

                Ok(SessionRecord {
                    session_id: row.get(0)?,
                    agent_type: serde_json::from_str(&agent_type_str)
                        .unwrap_or(crate::message_protocol::AgentType::Custom),
                    project_path: row.get(2)?,
                    started_at: row.get(3)?,
                    last_active_at: row.get(4)?,
                    status: status_str.parse().unwrap_or(SessionStatus::Active),
                    hostname: row.get(6)?,
                    os: row.get(7)?,
                    messages: Vec::new(),
                    metadata_json: row.get(8)?,
                })
            });

            match record {
                Ok(rec) => rec,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(e.into()),
            }
        };

        // Now get messages (lock is released)
        let messages = self.get_messages(&session_id_owned).await?;
        let mut result = rec;
        result.messages = messages;

        debug!("Loaded session: {}", session_id);
        Ok(Some(result))
    }

    async fn list_sessions(&self, filter: &SessionFilter) -> anyhow::Result<Vec<SessionRecord>> {
        let conn = self.conn.lock().await;

        let mut sql = String::from(
            r#"
            SELECT session_id, agent_type, project_path, started_at, last_active_at,
                   status, hostname, os, metadata_json
            FROM sessions
            WHERE 1=1
            "#,
        );

        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(agent_type) = &filter.agent_type {
            sql.push_str(" AND agent_type = ?");
            params_vec.push(Box::new(serde_json::to_string(agent_type)?));
        }

        if let Some(status) = &filter.status {
            sql.push_str(" AND status = ?");
            params_vec.push(Box::new(status.to_string()));
        }

        if let Some(project_path) = &filter.project_path {
            sql.push_str(" AND project_path = ?");
            params_vec.push(Box::new(project_path.clone()));
        }

        sql.push_str(" ORDER BY last_active_at DESC");

        if let Some(limit) = filter.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        if let Some(offset) = filter.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;

        let records = stmt.query_map(params_refs.as_slice(), |row| {
            let agent_type_str: String = row.get(1)?;
            let status_str: String = row.get(5)?;

            Ok(SessionRecord {
                session_id: row.get(0)?,
                agent_type: serde_json::from_str(&agent_type_str)
                    .unwrap_or(crate::message_protocol::AgentType::Custom),
                project_path: row.get(2)?,
                started_at: row.get(3)?,
                last_active_at: row.get(4)?,
                status: status_str.parse().unwrap_or(SessionStatus::Active),
                hostname: row.get(6)?,
                os: row.get(7)?,
                messages: Vec::new(),
                metadata_json: row.get(8)?,
            })
        })?;

        let mut results = Vec::new();
        for rec in records {
            results.push(rec?);
        }

        debug!("Listed {} sessions", results.len());
        Ok(results)
    }

    async fn update_session(&self, record: &SessionRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;

        conn.execute(
            r#"
            UPDATE sessions SET
                project_path = ?2,
                last_active_at = ?3,
                status = ?4,
                hostname = ?5,
                os = ?6,
                metadata_json = ?7,
                updated_at = datetime('now')
            WHERE session_id = ?1
            "#,
            params![
                record.session_id,
                record.project_path,
                record.last_active_at,
                record.status.to_string(),
                record.hostname,
                record.os,
                record.metadata_json,
            ],
        )?;

        debug!("Updated session: {}", record.session_id);
        Ok(())
    }

    async fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;

        // Delete messages first (foreign key)
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )?;

        // Delete session
        conn.execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            params![session_id],
        )?;

        debug!("Deleted session: {}", session_id);
        Ok(())
    }

    async fn add_message(&self, session_id: &str, message: &ChatMessage) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;

        conn.execute(
            r#"
            INSERT INTO messages (id, session_id, is_user, content, timestamp, sequence)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                message.id,
                session_id,
                message.is_user as i32,
                message.content,
                message.timestamp,
                message.sequence,
            ],
        )?;

        // Update last_active_at on sessions
        conn.execute(
            "UPDATE sessions SET last_active_at = ?2, updated_at = datetime('now') WHERE session_id = ?1",
            params![session_id, message.timestamp],
        )?;

        debug!("Added message to session: {}", session_id);
        Ok(())
    }

    async fn get_messages(&self, session_id: &str) -> anyhow::Result<Vec<ChatMessage>> {
        let conn = self.conn.lock().await;

        let mut stmt = conn.prepare(
            r#"
            SELECT id, is_user, content, timestamp, sequence, attachments
            FROM messages
            WHERE session_id = ?1
            ORDER BY sequence ASC
            "#,
        )?;

        let messages = stmt.query_map(params![session_id], |row| {
            let is_user: i32 = row.get(1)?;
            let attachments_str: Option<String> = row.get(5)?;
            let attachments: Option<Vec<String>> = match attachments_str {
                Some(s) => Some(serde_json::from_str(&s).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?),
                None => None,
            };
            Ok(ChatMessage {
                id: row.get(0)?,
                is_user: is_user != 0,
                content: row.get(2)?,
                timestamp: row.get(3)?,
                sequence: row.get(4)?,
                attachments,
            })
        })?;

        let mut results = Vec::new();
        for msg in messages {
            results.push(msg?);
        }

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[tokio::test]
    async fn test_session_store_crud() {
        let temp_dir = temp_dir().join("session_store_test");
        let store = SqliteSessionStore::new(&temp_dir).unwrap();

        let record = SessionRecord {
            session_id: "test-session-1".to_string(),
            agent_type: crate::message_protocol::AgentType::ClaudeCode,
            project_path: "/test".to_string(),
            started_at: 1000,
            last_active_at: 2000,
            status: SessionStatus::Active,
            hostname: "test-host".to_string(),
            os: "linux".to_string(),
            messages: vec![
                ChatMessage {
                    id: "msg-1".to_string(),
                    is_user: true,
                    content: "Hello".to_string(),
                    timestamp: 1000,
                    sequence: 0,
                    attachments: None,
                },
                ChatMessage {
                    id: "msg-2".to_string(),
                    is_user: false,
                    content: "Hi there!".to_string(),
                    timestamp: 1500,
                    sequence: 1,
                    attachments: None,
                },
            ],
            metadata_json: "{}".to_string(),
        };

        // Save
        store.save_session(&record).await.unwrap();

        // Load
        let loaded = store.load_session(&record.session_id).await.unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.session_id, record.session_id);
        assert_eq!(loaded.messages.len(), 2);

        // Update
        let mut updated = record.clone();
        updated.status = SessionStatus::Paused;
        store.update_session(&updated).await.unwrap();

        // List
        let sessions = store
            .list_sessions(&SessionFilter::default())
            .await
            .unwrap();
        assert_eq!(sessions.len(), 1);

        // Delete
        store.delete_session(&record.session_id).await.unwrap();

        let loaded = store.load_session(&record.session_id).await.unwrap();
        assert!(loaded.is_none());

        // Cleanup
        std::fs::remove_dir_all(temp_dir).ok();
    }
}
