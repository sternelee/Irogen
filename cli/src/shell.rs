// Shell detection and configuration module
#![allow(dead_code)]
// Currently unused in agent mode but kept for future compatibility

use std::collections::HashMap;

/// Shell type enumeration
#[derive(Debug, Clone, PartialEq)]
pub enum ShellType {
    Zsh,
    Bash,
    Fish,
    Nushell,
    PowerShell,
    Cmd,
    Unknown(String),
}

impl ShellType {
    /// Get the shell command path
    pub fn get_command_path(&self) -> &str {
        match self {
            ShellType::Zsh => "zsh",
            ShellType::Bash => "bash",
            ShellType::Fish => "fish",
            ShellType::Nushell => "nu",
            ShellType::PowerShell => "pwsh",
            ShellType::Cmd => "cmd",
            ShellType::Unknown(cmd) => cmd,
        }
    }

    /// Get display name for the shell
    pub fn get_display_name(&self) -> &str {
        match self {
            ShellType::Zsh => "Zsh",
            ShellType::Bash => "Bash",
            ShellType::Fish => "Fish",
            ShellType::Nushell => "Nushell",
            ShellType::PowerShell => "PowerShell",
            ShellType::Cmd => "Command Prompt",
            ShellType::Unknown(name) => name,
        }
    }
}

/// Shell configuration
#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub shell_type: ShellType,
    pub shell_path: String,
    pub env_vars: HashMap<String, String>,
}

impl ShellConfig {
    pub fn new(shell_type: ShellType, shell_path: String) -> Self {
        Self {
            shell_type,
            shell_path,
            env_vars: HashMap::new(),
        }
    }

    /// Create ShellConfig from shell path string
    pub fn from_shell_type(shell_path: &str) -> Self {
        let shell_type = if shell_path.contains("zsh") {
            ShellType::Zsh
        } else if shell_path.contains("bash") {
            ShellType::Bash
        } else if shell_path.contains("fish") {
            ShellType::Fish
        } else if shell_path.contains("nu") {
            ShellType::Nushell
        } else if shell_path.contains("pwsh") || shell_path.contains("powershell") {
            ShellType::PowerShell
        } else if shell_path.contains("cmd") {
            ShellType::Cmd
        } else {
            ShellType::Unknown(shell_path.to_string())
        };

        Self::new(shell_type, shell_path.to_string())
    }
}

impl std::fmt::Display for ShellType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.get_display_name())
    }
}

/// Shell detector for finding available shells
pub struct ShellDetector;

impl ShellDetector {
    /// Get the default shell for the current platform
    pub fn get_default_shell() -> ShellType {
        #[cfg(unix)]
        {
            std::env::var("SHELL")
                .ok()
                .and_then(|shell_path| {
                    if shell_path.contains("zsh") {
                        Some(ShellType::Zsh)
                    } else if shell_path.contains("bash") {
                        Some(ShellType::Bash)
                    } else if shell_path.contains("fish") {
                        Some(ShellType::Fish)
                    } else if shell_path.contains("nu") {
                        Some(ShellType::Nushell)
                    } else {
                        None
                    }
                })
                .unwrap_or(ShellType::Bash)
        }

        #[cfg(windows)]
        {
            ShellType::PowerShell
        }
    }

    /// Get the actual shell path from environment
    pub fn get_shell_path() -> String {
        #[cfg(unix)]
        {
            std::env::var("SHELL").unwrap_or_else(|_| {
                // Fallback to common shell paths
                if std::path::Path::new("/bin/zsh").exists() {
                    "/bin/zsh".to_string()
                } else if std::path::Path::new("/bin/bash").exists() {
                    "/bin/bash".to_string()
                } else {
                    "sh".to_string()
                }
            })
        }

        #[cfg(windows)]
        {
            // Try to find PowerShell
            std::env::var("COMSPEC").unwrap_or_else(|_| {
                if std::path::Path::new(
                    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                )
                .exists()
                {
                    "powershell.exe".to_string()
                } else {
                    "cmd.exe".to_string()
                }
            })
        }
    }

    /// Get shell configuration with path
    pub fn get_shell_config() -> ShellConfig {
        let shell_path = Self::get_shell_path();
        ShellConfig::from_shell_type(&shell_path)
    }
}
