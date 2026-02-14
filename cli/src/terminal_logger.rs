//! 终端日志记录模块
#![allow(dead_code)]
//!
//! 为每个终端会话提供日志记录功能，支持输入输出记录和日志轮转。

use anyhow::{Context, Result};
use riterm_shared::message_protocol::TerminalLogEntry;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::info;

use base64::{Engine, engine::general_purpose::STANDARD};

/// 默认最大日志行数
const DEFAULT_MAX_LOG_LINES: usize = 1000;

/// 日志级别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LogLevel {
    Info,
    Input,
    Output,
    Error,
}

impl ToString for LogLevel {
    fn to_string(&self) -> String {
        match self {
            LogLevel::Info => "INFO".to_string(),
            LogLevel::Input => "INPUT".to_string(),
            LogLevel::Output => "OUTPUT".to_string(),
            LogLevel::Error => "ERROR".to_string(),
        }
    }
}

/// 终端日志记录器
pub struct TerminalLogger {
    /// 终端ID
    terminal_id: String,
    /// 日志目录
    log_dir: PathBuf,
    /// 日志文件路径
    log_path: PathBuf,
    /// 内存中的日志缓存（最近N行）
    log_cache: Arc<Mutex<VecDeque<TerminalLogEntry>>>,
    /// 最大日志行数
    max_lines: usize,
}

impl TerminalLogger {
    /// 创建新的终端日志记录器
    pub fn new(terminal_id: String, log_dir: PathBuf, max_lines: Option<usize>) -> Result<Self> {
        let max_lines = max_lines.unwrap_or(DEFAULT_MAX_LOG_LINES);

        // 确保日志目录存在
        std::fs::create_dir_all(&log_dir).context("Failed to create log directory")?;

        // 创建日志文件路径：终端ID.log
        let log_path = log_dir.join(format!("{}.log", terminal_id));
        // 确保文件存在
        if !log_path.exists() {
            File::create(&log_path).context("Failed to create log file")?;
        }

        // 如果日志文件已存在，加载最近的日志到缓存
        let log_cache = Arc::new(Mutex::new(VecDeque::with_capacity(max_lines)));

        Ok(Self {
            terminal_id,
            log_dir,
            log_path,
            log_cache,
            max_lines,
        })
    }

    /// 记录输入数据
    pub fn log_input(&self, data: &[u8]) -> Result<()> {
        let timestamp = now_timestamp();
        let entry = TerminalLogEntry {
            timestamp,
            level: LogLevel::Input.to_string(),
            terminal_id: self.terminal_id.clone(),
            data_type: "input".to_string(),
            data: data.to_vec(),
        };

        self.write_entry(&entry)?;
        self.update_cache(entry);

        Ok(())
    }

    /// 记录输出数据
    pub fn log_output(&self, data: &[u8]) -> Result<()> {
        let timestamp = now_timestamp();
        let entry = TerminalLogEntry {
            timestamp,
            level: LogLevel::Output.to_string(),
            terminal_id: self.terminal_id.clone(),
            data_type: "output".to_string(),
            data: data.to_vec(),
        };

        self.write_entry(&entry)?;
        self.update_cache(entry);

        Ok(())
    }

    /// 记录错误数据
    pub fn log_error(&self, data: &[u8]) -> Result<()> {
        let timestamp = now_timestamp();
        let entry = TerminalLogEntry {
            timestamp,
            level: LogLevel::Error.to_string(),
            terminal_id: self.terminal_id.clone(),
            data_type: "error".to_string(),
            data: data.to_vec(),
        };

        self.write_entry(&entry)?;
        self.update_cache(entry);

        Ok(())
    }

    /// 记录信息日志
    pub fn log_info(&self, message: &str) -> Result<()> {
        let timestamp = now_timestamp();
        let entry = TerminalLogEntry {
            timestamp,
            level: LogLevel::Info.to_string(),
            terminal_id: self.terminal_id.clone(),
            data_type: "info".to_string(),
            data: message.as_bytes().to_vec(),
        };

        self.write_entry(&entry)?;
        self.update_cache(entry);

        Ok(())
    }

    /// 获取所有日志条目
    pub fn get_logs(&self) -> Vec<TerminalLogEntry> {
        let cache = self.log_cache.lock().unwrap();
        cache.iter().cloned().collect()
    }

    /// 获取日志文件路径
    pub fn log_path(&self) -> &Path {
        &self.log_path
    }

    /// 从文件重新加载日志
    pub fn reload_from_file(&self) -> Result<usize> {
        let mut cache = self.log_cache.lock().unwrap();
        cache.clear();

        if !self.log_path.exists() {
            return Ok(0);
        }

        let file = File::open(&self.log_path).context("Failed to open log file")?;
        let reader = BufReader::new(file);

        let mut count = 0;
        for line in reader.lines() {
            let line = line.context("Failed to read log line")?;
            if let Some(entry) = parse_log_line(&line) {
                if cache.len() >= self.max_lines {
                    cache.pop_front();
                }
                cache.push_back(entry);
                count += 1;
            }
        }

        Ok(count)
    }

    /// 写入日志条目到文件
    fn write_entry(&self, entry: &TerminalLogEntry) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .context("Failed to open log file")?;

        // 格式: timestamp|level|data_type|data_base64
        let data_base64 = STANDARD.encode(&entry.data);
        let log_line = format!(
            "{}|{}|{}|{}\n",
            entry.timestamp, entry.level, entry.data_type, data_base64
        );

        file.write_all(log_line.as_bytes())
            .context("Failed to write log entry")?;

        Ok(())
    }

    /// 更新内存缓存
    fn update_cache(&self, entry: TerminalLogEntry) {
        let mut cache = self.log_cache.lock().unwrap();
        if cache.len() >= self.max_lines {
            cache.pop_front();
        }
        cache.push_back(entry);
    }

    /// 清理日志文件（删除旧内容）
    pub fn clear(&self) -> Result<()> {
        std::fs::write(&self.log_path, []).context("Failed to clear log file")?;

        let mut cache = self.log_cache.lock().unwrap();
        cache.clear();

        Ok(())
    }

    /// 删除日志文件
    pub fn delete_log_file(&self) -> Result<()> {
        if self.log_path.exists() {
            std::fs::remove_file(&self.log_path).context("Failed to delete log file")?;
            info!("Log file deleted: {:?}", self.log_path);
        }
        Ok(())
    }
}

/// 获取当前时间戳（秒）
fn now_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// 解析日志行
fn parse_log_line(line: &str) -> Option<TerminalLogEntry> {
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() != 4 {
        return None;
    }

    let timestamp: u64 = parts[0].parse().ok()?;
    let level = parts[1].to_string();
    let data_type = parts[2].to_string();

    // 解码 base64 数据
    let data = STANDARD.decode(parts[3]).ok()?;

    Some(TerminalLogEntry {
        timestamp,
        level,
        terminal_id: String::new(), // 由调用者设置
        data_type,
        data,
    })
}

/// 终端日志管理器
pub struct TerminalLogManager {
    /// 日志目录
    log_dir: PathBuf,
    /// 所有日志记录器
    loggers: Arc<Mutex<std::collections::HashMap<String, Arc<TerminalLogger>>>>,
    /// 最大日志行数
    max_lines: usize,
}

impl TerminalLogManager {
    /// 创建新的日志管理器
    pub fn new(log_dir: PathBuf, max_lines: Option<usize>) -> Self {
        let max_lines = max_lines.unwrap_or(DEFAULT_MAX_LOG_LINES);

        // 确保日志目录存在
        let _ = std::fs::create_dir_all(&log_dir);

        Self {
            log_dir,
            loggers: Arc::new(Mutex::new(std::collections::HashMap::new())),
            max_lines,
        }
    }

    /// 获取或创建终端日志记录器
    pub fn get_logger(&self, terminal_id: &str) -> Arc<TerminalLogger> {
        let mut loggers = self.loggers.lock().unwrap();

        if let Some(logger) = loggers.get(terminal_id) {
            return logger.clone();
        }

        let logger = Arc::new(
            TerminalLogger::new(
                terminal_id.to_string(),
                self.log_dir.clone(),
                Some(self.max_lines),
            )
            .unwrap_or_else(|e| {
                eprintln!(
                    "Failed to create logger for terminal {}: {}",
                    terminal_id, e
                );
                // 创建一个不写入文件的fallback logger
                TerminalLogger::new(
                    terminal_id.to_string(),
                    PathBuf::from("/tmp/riterm/logs"),
                    Some(self.max_lines),
                )
                .unwrap()
            }),
        );

        loggers.insert(terminal_id.to_string(), logger.clone());
        logger
    }

    /// 移除终端日志记录器
    pub fn remove_logger(&self, terminal_id: &str) {
        let mut loggers = self.loggers.lock().unwrap();
        loggers.remove(terminal_id);
    }

    /// 移除终端日志记录器并删除日志文件
    pub fn remove_logger_with_file(&self, terminal_id: &str) -> Result<()> {
        let logger = {
            let mut loggers = self.loggers.lock().unwrap();
            loggers.remove(terminal_id)
        };

        if let Some(logger) = logger {
            logger.delete_log_file()?;
        }

        Ok(())
    }

    /// 清理所有日志
    pub fn clear_all(&self) -> Result<()> {
        let loggers = self.loggers.lock().unwrap();
        for logger in loggers.values() {
            logger.clear()?;
        }
        Ok(())
    }

    /// 获取日志目录
    pub fn log_dir(&self) -> &Path {
        &self.log_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_log_entry_parsing() {
        let data = b"test data";
        let data_base64 = STANDARD.encode(data);
        let line = format!("1234567890|INPUT|input|{}", data_base64);

        let entry = parse_log_line(&line).unwrap();
        assert_eq!(entry.timestamp, 1234567890);
        assert_eq!(entry.level, "INPUT");
        assert_eq!(entry.data_type, "input");
        assert_eq!(entry.data, data);
    }

    #[test]
    fn test_logger_creation() {
        let temp_dir = TempDir::new().unwrap();
        let logger = TerminalLogger::new(
            "test-terminal".to_string(),
            temp_dir.path().to_path_buf(),
            Some(10),
        )
        .unwrap();

        assert_eq!(logger.terminal_id, "test-terminal");
        assert!(logger.log_path().exists());
    }

    #[test]
    fn test_logging() {
        let temp_dir = TempDir::new().unwrap();
        let logger = TerminalLogger::new(
            "test-terminal".to_string(),
            temp_dir.path().to_path_buf(),
            Some(10),
        )
        .unwrap();

        logger.log_input(b"hello").unwrap();
        logger.log_output(b"world").unwrap();

        let logs = logger.get_logs();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].data, b"hello");
        assert_eq!(logs[1].data, b"world");
    }

    #[test]
    fn test_log_rotation() {
        let temp_dir = TempDir::new().unwrap();
        let logger = TerminalLogger::new(
            "test-terminal".to_string(),
            temp_dir.path().to_path_buf(),
            Some(3), // 只保留3行
        )
        .unwrap();

        // 写入5条日志
        for i in 1..=5 {
            logger.log_output(format!("line {}", i).as_bytes()).unwrap();
        }

        let logs = logger.get_logs();
        // 应该只保留最后3条
        assert_eq!(logs.len(), 3);
        assert_eq!(String::from_utf8_lossy(&logs[0].data), "line 3");
        assert_eq!(String::from_utf8_lossy(&logs[2].data), "line 5");
    }
}
