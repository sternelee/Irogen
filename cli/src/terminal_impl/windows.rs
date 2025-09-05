use std::pin::Pin;
use std::process::Command;
use std::task::Context;
use std::task::Poll;

use anyhow::Result;
use pin_project::{pin_project, pinned_drop};
use tokio::fs::{self, File};
use tokio::io::{self, AsyncRead, AsyncWrite};
use tracing::instrument;

/// 获取系统默认 shell
/// 
/// 对于 Windows，目前只是在几个位置查找 shell。如果失败，返回 `cmd.exe`。
/// 
/// 注意：我无法让 `powershell.exe` 与 ConPTY 一起工作，因为它返回错误 8009001d。
/// 有一些魔法环境变量需要为 Powershell 启动而设置。这就是我通常不使用 Windows 的原因！
pub async fn get_default_shell() -> String {
    for shell in [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Windows\\System32\\cmd.exe",
    ] {
        if fs::metadata(shell).await.is_ok() {
            return shell.to_string();
        }
    }
    String::from("cmd.exe")
}

/// 存储终端会话状态的对象
#[pin_project(PinnedDrop)]
pub struct Terminal {
    child: conpty::Process,
    #[pin]
    reader: File,
    #[pin]
    writer: File,
    winsize: (u16, u16),
}

impl Terminal {
    /// 创建新的终端，附带 PTY
    #[instrument]
    pub async fn new(shell: &str) -> Result<Terminal> {
        let mut command = Command::new(shell);

        // 适当设置终端环境变量
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "iroh-code-remote");
        command.env_remove("TERM_PROGRAM_VERSION");

        let mut child =
            tokio::task::spawn_blocking(move || conpty::Process::spawn(command)).await??;
        let reader = File::from_std(child.output()?.into());
        let writer = File::from_std(child.input()?.into());

        Ok(Self {
            child,
            reader,
            writer,
            winsize: (0, 0),
        })
    }

    /// 获取 TTY 的窗口大小
    pub fn get_winsize(&self) -> Result<(u16, u16)> {
        Ok(self.winsize)
    }

    /// 设置 TTY 的窗口大小
    pub fn set_winsize(&mut self, rows: u16, cols: u16) -> Result<()> {
        let rows_i16 = rows.min(i16::MAX as u16) as i16;
        let cols_i16 = cols.min(i16::MAX as u16) as i16;
        self.child.resize(cols_i16, rows_i16)?; // 注意参数顺序
        self.winsize = (rows, cols);
        Ok(())
    }
}

// 将终端读取重定向到读取文件对象
impl AsyncRead for Terminal {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut io::ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.project().reader.poll_read(cx, buf)
    }
}

// 将终端写入重定向到写入文件对象
impl AsyncWrite for Terminal {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.project().writer.poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.project().writer.poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.project().writer.poll_shutdown(cx)
    }
}

#[pinned_drop]
impl PinnedDrop for Terminal {
    fn drop(self: Pin<&mut Self>) {
        let this = self.project();
        this.child.exit(0).ok();
    }
}