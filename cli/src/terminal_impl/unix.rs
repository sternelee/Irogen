use std::convert::Infallible;
use std::env;
use std::ffi::{CStr, CString};
use std::os::fd::{AsRawFd, RawFd};
use std::pin::Pin;
use std::task::{Context, Poll};

use anyhow::Result;
use close_fds::CloseFdsBuilder;
use nix::errno::Errno;
use nix::libc::{login_tty, TIOCGWINSZ, TIOCSWINSZ};
use nix::pty::{self, Winsize};
use nix::sys::signal::{kill, Signal::SIGKILL};
use nix::sys::wait::waitpid;
use nix::unistd::{execvp, fork, ForkResult, Pid};
use pin_project::{pin_project, pinned_drop};
use tokio::fs::{self, File};
use tokio::io::{self, AsyncRead, AsyncWrite};
use tracing::{instrument, trace};

/// 获取系统默认 shell
pub async fn get_default_shell() -> String {
    if let Ok(shell) = env::var("SHELL") {
        if !shell.is_empty() {
            return shell;
        }
    }
    for shell in [
        "/bin/bash",
        "/bin/sh", 
        "/usr/local/bin/bash",
        "/usr/local/bin/sh",
    ] {
        if fs::metadata(shell).await.is_ok() {
            return shell.to_string();
        }
    }
    String::from("sh")
}

/// 存储终端会话状态的对象，类似 sshx 的 Terminal
#[pin_project(PinnedDrop)]
pub struct Terminal {
    child: Pid,
    #[pin]
    master_read: File,
    #[pin] 
    master_write: File,
}

impl Terminal {
    /// 创建新的终端，附带 PTY，完全参考 sshx 实现
    #[instrument]
    pub async fn new(shell: &str) -> Result<Terminal> {
        let result = pty::openpty(None, None)?;

        // slave 文件描述符由 openpty() 创建，这里进行 fork
        let child = Self::fork_child(shell, result.slave.as_raw_fd())?;

        // 我们需要克隆文件对象以防止 Tokio 中的活锁，当同一文件描述符上发生并发读写时。
        // 这是 `tokio::fs::File` 结构实现的当前限制，由于它在单独线程上的阻塞 I/O。
        let master_read = File::from(std::fs::File::from(result.master));
        let master_write = master_read.try_clone().await?;

        trace!(%child, "创建新终端");

        Ok(Self {
            child,
            master_read,
            master_write,
        })
    }

    /// 子进程入口点，用于生成 shell，完全参考 sshx
    fn fork_child(shell: &str, slave_port: RawFd) -> Result<Pid> {
        let shell = CString::new(shell.to_owned())?;

        // 安全：这在子分支中不使用任何异步信号不安全操作，如内存分配。
        match unsafe { fork() }? {
            ForkResult::Parent { child } => Ok(child),
            ForkResult::Child => match Self::execv_child(&shell, slave_port) {
                Ok(infallible) => match infallible {},
                Err(_) => std::process::exit(1),
            },
        }
    }

    fn execv_child(shell: &CStr, slave_port: RawFd) -> Result<Infallible, Errno> {
        // 安全：slave 文件描述符由 openpty() 创建。
        Errno::result(unsafe { login_tty(slave_port) })?;
        // 安全：这在 execv() 之前立即调用，此进程中没有其他线程与其文件描述符表交互。
        unsafe { CloseFdsBuilder::new().closefrom(3) };

        // 适当设置终端环境变量，使用 iroh-code-remote
        unsafe {
            env::set_var("TERM", "xterm-256color");
            env::set_var("COLORTERM", "truecolor");
            env::set_var("TERM_PROGRAM", "iroh-code-remote");
            env::remove_var("TERM_PROGRAM_VERSION");
        }

        // 启动进程
        execvp(shell, &[shell])
    }

    /// 获取 TTY 的窗口大小
    pub fn get_winsize(&self) -> Result<(u16, u16)> {
        nix::ioctl_read_bad!(ioctl_get_winsize, TIOCGWINSZ, Winsize);
        let mut winsize = make_winsize(0, 0);
        // 安全：master 文件描述符由 openpty() 创建。
        unsafe { ioctl_get_winsize(self.master_read.as_raw_fd(), &mut winsize) }?;
        Ok((winsize.ws_row, winsize.ws_col))
    }

    /// 设置 TTY 的窗口大小
    pub fn set_winsize(&mut self, rows: u16, cols: u16) -> Result<()> {
        nix::ioctl_write_ptr_bad!(ioctl_set_winsize, TIOCSWINSZ, Winsize);
        let winsize = make_winsize(rows, cols);
        // 安全：master 文件描述符由 openpty() 创建。
        unsafe { ioctl_set_winsize(self.master_read.as_raw_fd(), &winsize) }?;
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
        self.project().master_read.poll_read(cx, buf)
    }
}

// 将终端写入重定向到写入文件对象
impl AsyncWrite for Terminal {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.project().master_write.poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.project().master_write.poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.project().master_write.poll_shutdown(cx)
    }
}

#[pinned_drop]
impl PinnedDrop for Terminal {
    fn drop(self: Pin<&mut Self>) {
        let this = self.project();
        let child = *this.child;
        trace!(%child, "丢弃终端");

        // 关闭时杀死子进程，这样它不会继续运行。
        kill(child, SIGKILL).ok();

        // 在后台线程中回收僵尸进程。
        std::thread::spawn(move || {
            waitpid(child, None).ok();
        });
    }
}

fn make_winsize(rows: u16, cols: u16) -> Winsize {
    Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0, // 忽略
        ws_ypixel: 0, // 忽略
    }
}