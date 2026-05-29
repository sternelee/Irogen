use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Expand `~` in a path to the user's home directory
pub fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(&path[2..]);
        }
    } else if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

/// Execute a shell command locally with a 30-second timeout.
/// `cwd` is expanded (supports `~`) before use.
pub async fn exec_local(command: &str, cwd: Option<&str>) -> Result<ShellExecResult, String> {
    let shell = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C".to_string(), command.to_string()])
    } else {
        ("sh", vec!["-c".to_string(), command.to_string()])
    };

    let mut cmd = tokio::process::Command::new(shell.0);
    cmd.args(&shell.1);
    cmd.env("PAGER", "");
    if let Some(dir) = cwd {
        cmd.current_dir(expand_tilde(dir));
    }

    let timeout = Duration::from_secs(30);
    match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code();
            let success = output.status.success();
            Ok(ShellExecResult { success, stdout, stderr, exit_code })
        }
        Ok(Err(e)) => Err(format!("Failed to execute command: {}", e)),
        Err(_) => Err(format!("Command timed out after {}s", timeout.as_secs())),
    }
}
