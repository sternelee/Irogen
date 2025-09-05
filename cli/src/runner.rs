//! 基于 sshx 实现的 Runner 模块
//! 定义控制客户端中单个 shell 行为的任务

use anyhow::Result;
use encoding_rs::{CoderResult, UTF_8};
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
};
use tracing::{debug, error};

use crate::session_encrypt::SessionEncrypt;
use crate::terminal_impl::Terminal;

// 参考 sshx 的常量
const CONTENT_CHUNK_SIZE: usize = 1 << 16; // 一次最多发送这么多字节
const CONTENT_ROLLING_BYTES: usize = 8 << 20; // 至少存储这么多内容
const CONTENT_PRUNE_BYTES: usize = 12 << 20; // 超过此长度时进行修剪

/// Shell ID，类似 sshx 中的 Sid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Sid(pub u64);

impl std::fmt::Display for Sid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 终端行为变体，由控制器使用，参考 sshx
#[derive(Debug, Clone)]
pub enum Runner {
    /// 生成指定的 shell 作为子进程，转发 PTY
    Shell(String),

    /// 模拟运行器，只回显其输入，用于测试
    Echo,
}

/// 路由到 shell 运行器的内部消息，参考 sshx 的 ShellData
pub enum ShellData {
    /// 来自服务器的输入字节序列
    Data(Vec<u8>),
    /// 关于服务器当前序列号的信息
    Sync(u64),
    /// 将 shell 大小调整为不同的行数和列数
    Size(u32, u32),
}

/// 终端数据消息，类似 sshx 的 TerminalData
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalData {
    pub id: u64,
    pub data: Vec<u8>,
    pub seq: u64,
}

/// 客户端消息，类似 sshx 的 ClientMessage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    /// Hello 握手消息
    Hello(String),
    /// 终端数据
    Data(TerminalData),
    /// Shell 已创建
    CreatedShell(NewShell),
    /// Shell 已关闭
    ClosedShell(u64),
    /// Pong 响应
    Pong(u64),
    /// 错误消息
    Error(String),
}

/// 新 Shell 信息，类似 sshx 的 NewShell
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewShell {
    pub id: u64,
    pub x: i32,
    pub y: i32,
}

impl Runner {
    /// 运行单个带进程 I/O 的 shell 的异步任务，参考 sshx
    pub async fn run(
        &self,
        id: Sid,
        encrypt: SessionEncrypt,
        shell_rx: mpsc::Receiver<ShellData>,
        output_tx: mpsc::Sender<ClientMessage>,
    ) -> Result<()> {
        match self {
            Self::Shell(shell) => shell_task(id, encrypt, shell, shell_rx, output_tx).await,
            Self::Echo => echo_task(id, encrypt, shell_rx, output_tx).await,
        }
    }
}

/// 处理会话中单个 shell 的异步任务，完全参考 sshx 实现
async fn shell_task(
    id: Sid,
    encrypt: SessionEncrypt,
    shell: &str,
    mut shell_rx: mpsc::Receiver<ShellData>,
    output_tx: mpsc::Sender<ClientMessage>,
) -> Result<()> {
    let mut term = Terminal::new(shell).await?;
    term.set_winsize(24, 80)?;

    let mut content = String::new(); // 来自终端的内容
    let mut content_offset = 0; // `content` 第一个字符之前的字节数
    let mut decoder = UTF_8.new_decoder(); // UTF-8 流解码器
    let mut seq = 0; // 我们对服务器序列号的日志
    let mut seq_outdated = 0; // seq 过时的次数
    let mut buf = [0u8; 4096]; // 读取缓冲区
    let mut finished = false; // 完成时设置

    while !finished {
        tokio::select! {
            result = term.read(&mut buf) => {
                let n = result?;
                if n == 0 {
                    finished = true;
                } else {
                    content.reserve(decoder.max_utf8_buffer_length(n).unwrap());
                    let (result, _, _) = decoder.decode_to_string(&buf[..n], &mut content, false);
                    debug_assert!(result == CoderResult::InputEmpty);
                }
            }
            item = shell_rx.recv() => {
                match item {
                    Some(ShellData::Data(data)) => {
                        term.write_all(&data).await?;
                    }
                    Some(ShellData::Sync(seq2)) => {
                        if seq2 < seq as u64 {
                            seq_outdated += 1;
                            if seq_outdated >= 3 {
                                seq = seq2 as usize;
                            }
                        }
                    }
                    Some(ShellData::Size(rows, cols)) => {
                        term.set_winsize(rows as u16, cols as u16)?;
                    }
                    None => finished = true, // 服务器关闭了这个 shell
                }
            }
        }

        if finished {
            content.reserve(decoder.max_utf8_buffer_length(0).unwrap());
            let (result, _, _) = decoder.decode_to_string(&[], &mut content, true);
            debug_assert!(result == CoderResult::InputEmpty);
        }

        // 如果服务器落后，发送数据
        if content_offset + content.len() > seq {
            let start = prev_char_boundary(&content, seq - content_offset);
            let end = prev_char_boundary(&content, (start + CONTENT_CHUNK_SIZE).min(content.len()));
            let data = encrypt.segment(
                0x100000000 | id.0 as u64, // 流编号
                (content_offset + start) as u64,
                &content.as_bytes()[start..end],
            );
            let data = TerminalData {
                id: id.0,
                data,
                seq: (content_offset + start) as u64,
            };
            output_tx.send(ClientMessage::Data(data)).await?;
            seq = content_offset + end;
            seq_outdated = 0;
        }

        if content.len() > CONTENT_PRUNE_BYTES && seq - CONTENT_ROLLING_BYTES > content_offset {
            let pruned = (seq - CONTENT_ROLLING_BYTES) - content_offset;
            let pruned = prev_char_boundary(&content, pruned);
            content_offset += pruned;
            content.drain(..pruned);
        }
    }
    Ok(())
}

/// 在 O(1) 时间内找到索引前的最后一个字符边界，来自 sshx
fn prev_char_boundary(s: &str, i: usize) -> usize {
    (0..=i)
        .rev()
        .find(|&j| s.is_char_boundary(j))
        .expect("没有前一个字符边界")
}

async fn echo_task(
    id: Sid,
    encrypt: SessionEncrypt,
    mut shell_rx: mpsc::Receiver<ShellData>,
    output_tx: mpsc::Sender<ClientMessage>,
) -> Result<()> {
    let mut seq = 0;
    while let Some(item) = shell_rx.recv().await {
        match item {
            ShellData::Data(data) => {
                let msg = String::from_utf8_lossy(&data);
                let term_data = TerminalData {
                    id: id.0,
                    data: encrypt
                        .segment(0x100000000 | id.0 as u64, seq, msg.as_bytes()),
                    seq,
                };
                output_tx.send(ClientMessage::Data(term_data)).await?;
                seq += msg.len() as u64;
            }
            ShellData::Sync(_) => (),
            ShellData::Size(_, _) => (),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prev_char_boundary() {
        let s = "hello 世界";
        assert_eq!(prev_char_boundary(s, 0), 0);
        assert_eq!(prev_char_boundary(s, 5), 5);
        assert_eq!(prev_char_boundary(s, 6), 6); // 空格
        assert_eq!(prev_char_boundary(s, 7), 7); // '世' 的开始
        assert_eq!(prev_char_boundary(s, 8), 7); // '世' 内部
        assert_eq!(prev_char_boundary(s, 9), 7); // '世' 内部
    }

    #[test]
    fn test_sid_display() {
        let sid = Sid(42);
        assert_eq!(format!("{}", sid), "42");
    }
}