//! Minimal configuration types for ZeroClaw agent.

use serde::{Deserialize, Serialize};

// Re-export AutonomyLevel from security to avoid duplicates
pub use crate::security::AutonomyLevel;

// ── Autonomy ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomyConfig {
    pub level: AutonomyLevel,
    pub workspace_only: bool,
    pub allowed_commands: Vec<String>,
    pub forbidden_paths: Vec<String>,
    pub max_actions_per_hour: u32,
    pub max_cost_per_day_cents: u32,
    pub require_approval_for_medium_risk: bool,
    pub block_high_risk_commands: bool,
}

impl Default for AutonomyConfig {
    fn default() -> Self {
        Self {
            level: AutonomyLevel::Supervised,
            workspace_only: true,
            allowed_commands: vec![
                "ls".into(),
                "cat".into(),
                "head".into(),
                "tail".into(),
                "grep".into(),
                "find".into(),
                "echo".into(),
                "pwd".into(),
                "wc".into(),
                "sort".into(),
                "uniq".into(),
                "diff".into(),
                "which".into(),
                "whoami".into(),
                "git".into(),
                "cargo".into(),
                "npm".into(),
                "pnpm".into(),
                "yarn".into(),
                "node".into(),
                "python".into(),
                "pip".into(),
                "uv".into(),
                "rustc".into(),
                "rustup".into(),
            ],
            forbidden_paths: vec![
                "/etc/shadow".into(),
                "/etc/passwd".into(),
                "~/.ssh".into(),
                "~/.aws".into(),
                "~/.gnupg".into(),
            ],
            max_actions_per_hour: 100,
            max_cost_per_day_cents: 500,
            require_approval_for_medium_risk: true,
            block_high_risk_commands: true,
        }
    }
}

// ── Memory ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    /// "sqlite" | "markdown" | "none"
    pub backend: String,
    /// Auto-save conversation context to memory
    pub auto_save: bool,
    /// Embedding provider: "openai", "custom:<base_url>", "none"
    pub embedding_provider: String,
    /// Embedding model name (e.g. "text-embedding-3-small")
    pub embedding_model: String,
    /// Embedding vector dimensions
    pub embedding_dimensions: usize,
    /// Weight for vector similarity in hybrid search (0.0–1.0)
    pub vector_weight: f64,
    /// Weight for keyword (BM25) in hybrid search (0.0–1.0)
    pub keyword_weight: f64,
    /// Max entries in embedding cache (LRU eviction)
    pub embedding_cache_size: usize,
    /// Enable periodic hygiene (archive + purge + prune)
    pub hygiene_enabled: bool,
    /// Archive daily memory files older than N days
    pub archive_after_days: u32,
    /// Purge archived files older than N days
    pub purge_after_days: u32,
    /// Prune conversation rows older than N days (0 = disable)
    pub conversation_retention_days: u32,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            backend: "sqlite".into(),
            auto_save: true,
            embedding_provider: "none".into(),
            embedding_model: "text-embedding-3-small".into(),
            embedding_dimensions: 1536,
            vector_weight: 0.7,
            keyword_weight: 0.3,
            embedding_cache_size: 10_000,
            hygiene_enabled: true,
            archive_after_days: 7,
            purge_after_days: 30,
            conversation_retention_days: 14,
        }
    }
}

// ── Reliability ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReliabilityConfig {
    pub provider_retries: u32,
    pub provider_backoff_ms: u64,
    pub fallback_providers: Vec<String>,
    pub channel_initial_backoff_secs: u64,
    pub channel_max_backoff_secs: u64,
    pub scheduler_poll_secs: u64,
    pub scheduler_retries: u32,
}

impl Default for ReliabilityConfig {
    fn default() -> Self {
        Self {
            provider_retries: 2,
            provider_backoff_ms: 500,
            fallback_providers: vec![],
            channel_initial_backoff_secs: 2,
            channel_max_backoff_secs: 60,
            scheduler_poll_secs: 15,
            scheduler_retries: 2,
        }
    }
}

// ── Model Routes ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRouteConfig {
    /// Task hint name (e.g. "reasoning", "fast", "code", "summarize")
    pub hint: String,
    /// Provider to route to (must match a known provider name)
    pub provider: String,
    /// Model to use with that provider
    pub model: String,
    /// Optional API key override for this route's provider
    #[serde(default)]
    pub api_key: Option<String>,
}
