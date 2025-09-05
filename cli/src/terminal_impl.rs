//! 基于 sshx 实现的真正终端驱动模块
//! 使用 PTY 与 shell 子进程通信

#![allow(unsafe_code)]

cfg_if::cfg_if! {
    if #[cfg(unix)] {
        mod unix;
        pub use unix::{get_default_shell, Terminal};
    } else if #[cfg(windows)] {
        mod windows;
        pub use windows::{get_default_shell, Terminal};
    } else {
        compile_error!("不支持的终端驱动平台");
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use super::Terminal;

    #[tokio::test]
    async fn test_winsize() -> Result<()> {
        let shell = if cfg!(unix) { "/bin/sh" } else { "cmd.exe" };
        let mut terminal = Terminal::new(shell).await?;
        assert_eq!(terminal.get_winsize()?, (0, 0));
        terminal.set_winsize(120, 72)?;
        assert_eq!(terminal.get_winsize()?, (120, 72));
        Ok(())
    }
}