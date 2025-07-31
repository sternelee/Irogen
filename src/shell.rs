use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::process::Command;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ShellType {
    Bash,
    Zsh,
    Fish,
    Nushell,
    PowerShell,
    Cmd,
    Custom(String),
}

impl ShellType {
    pub fn from_command(command: &str) -> Self {
        let shell_name = Path::new(command)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(command)
            .to_lowercase();

        match shell_name.as_str() {
            "bash" => ShellType::Bash,
            "zsh" => ShellType::Zsh,
            "fish" => ShellType::Fish,
            "nu" | "nushell" => ShellType::Nushell,
            "pwsh" | "powershell" => ShellType::PowerShell,
            "cmd" | "cmd.exe" => ShellType::Cmd,
            _ => ShellType::Custom(command.to_string()),
        }
    }

    pub fn get_command_path(&self) -> &str {
        match self {
            ShellType::Bash => "bash",
            ShellType::Zsh => "zsh",
            ShellType::Fish => "fish",
            ShellType::Nushell => "nu",
            ShellType::PowerShell => "pwsh",
            ShellType::Cmd => "cmd",
            ShellType::Custom(cmd) => cmd,
        }
    }

    pub fn get_display_name(&self) -> &str {
        match self {
            ShellType::Bash => "Bash",
            ShellType::Zsh => "Zsh",
            ShellType::Fish => "Fish",
            ShellType::Nushell => "Nushell",
            ShellType::PowerShell => "PowerShell",
            ShellType::Cmd => "Command Prompt",
            ShellType::Custom(cmd) => cmd,
        }
    }

    pub fn get_environment_variables(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // Common environment variables
        env_vars.insert("TERM".to_string(), "xterm-256color".to_string());

        match self {
            ShellType::Bash => {
                env_vars.insert("SHELL".to_string(), "/bin/bash".to_string());
                env_vars.insert("BASH_ENV".to_string(), "~/.bashrc".to_string());
            }
            ShellType::Zsh => {
                env_vars.insert("SHELL".to_string(), "/bin/zsh".to_string());
                env_vars.insert(
                    "ZDOTDIR".to_string(),
                    env::var("ZDOTDIR").unwrap_or_else(|_| "~".to_string()),
                );
            }
            ShellType::Fish => {
                env_vars.insert("SHELL".to_string(), "/usr/bin/fish".to_string());
                // Fish doesn't use traditional environment variables for config
            }
            ShellType::Nushell => {
                env_vars.insert("SHELL".to_string(), "/usr/bin/nu".to_string());
                // Nushell has its own config system
            }
            ShellType::PowerShell => {
                env_vars.insert("SHELL".to_string(), "pwsh".to_string());
            }
            ShellType::Cmd => {
                env_vars.insert("COMSPEC".to_string(), "cmd.exe".to_string());
            }
            ShellType::Custom(_) => {
                // Use defaults for custom shells
            }
        }

        env_vars
    }

    pub fn get_init_commands(&self) -> Vec<String> {
        match self {
            ShellType::Bash => vec![
                "export PS1='\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '".to_string(),
                "echo '🐚 Bash shell initialized in roterm session'".to_string(),
            ],
            ShellType::Zsh => vec![
                "autoload -U colors && colors".to_string(),
                "export PS1='%{$fg[green]%}%n@%m%{$reset_color%}:%{$fg[blue]%}%~%{$reset_color%}$ '".to_string(),
                "echo '🐚 Zsh shell initialized in roterm session'".to_string(),
            ],
            ShellType::Fish => vec![
                "set -g fish_greeting '🐚 Fish shell initialized in roterm session'".to_string(),
                "function fish_prompt; echo (set_color green)(whoami)'@'(hostname)(set_color normal)':'(set_color blue)(pwd)(set_color normal)'$ '; end".to_string(),
            ],
            ShellType::Nushell => vec![
                "echo '🐚 Nushell initialized in roterm session'".to_string(),
            ],
            ShellType::PowerShell => vec![
                "Write-Host '🐚 PowerShell initialized in roterm session' -ForegroundColor Green".to_string(),
            ],
            ShellType::Cmd => vec![
                "echo 🐚 Command Prompt initialized in roterm session".to_string(),
            ],
            ShellType::Custom(_) => vec![],
        }
    }

    pub fn supports_interactive_mode(&self) -> bool {
        match self {
            ShellType::Bash | ShellType::Zsh | ShellType::Fish | ShellType::Nushell => true,
            ShellType::PowerShell => true,
            ShellType::Cmd => false, // CMD has limited interactive features
            ShellType::Custom(_) => true, // Assume custom shells support interactive mode
        }
    }

    pub fn get_interactive_args(&self) -> Vec<String> {
        match self {
            ShellType::Bash => vec!["-i".to_string()],
            ShellType::Zsh => vec!["-i".to_string()],
            ShellType::Fish => vec!["-i".to_string()],
            ShellType::Nushell => vec!["-i".to_string()],
            ShellType::PowerShell => vec!["-Interactive".to_string()],
            ShellType::Cmd => vec![],
            ShellType::Custom(_) => vec!["-i".to_string()], // Common default
        }
    }
}

pub struct ShellDetector;

impl ShellDetector {
    pub fn detect_available_shells() -> Vec<ShellType> {
        let shells_to_check = vec![
            ShellType::Bash,
            ShellType::Zsh,
            ShellType::Fish,
            ShellType::Nushell,
            ShellType::PowerShell,
        ];

        let mut available_shells = Vec::new();

        for shell in shells_to_check {
            if Self::is_shell_available(&shell) {
                available_shells.push(shell);
            }
        }

        // Add CMD on Windows
        if cfg!(windows) {
            available_shells.push(ShellType::Cmd);
        }

        available_shells
    }

    pub fn get_current_shell() -> Option<ShellType> {
        // Try to get from environment variables
        if let Ok(shell_path) = env::var("SHELL") {
            return Some(ShellType::from_command(&shell_path));
        }

        // Fallback to checking parent process or common shells
        Self::detect_available_shells().into_iter().next()
    }

    pub fn get_default_shell() -> ShellType {
        Self::get_current_shell().unwrap_or_else(|| {
            if cfg!(windows) {
                ShellType::PowerShell
            } else {
                ShellType::Bash
            }
        })
    }

    fn is_shell_available(shell: &ShellType) -> bool {
        let command = shell.get_command_path();

        let result = Command::new("which")
            .arg(command)
            .output()
            .or_else(|_| Command::new("where").arg(command).output());

        match result {
            Ok(output) => {
                let available = output.status.success();
                if available {
                    debug!(
                        "Found shell: {} at {:?}",
                        shell.get_display_name(),
                        String::from_utf8_lossy(&output.stdout).trim()
                    );
                } else {
                    debug!("Shell {} not found", shell.get_display_name());
                }
                available
            }
            Err(e) => {
                warn!(
                    "Failed to check availability of {}: {}",
                    shell.get_display_name(),
                    e
                );
                false
            }
        }
    }

    pub fn validate_shell_command(command: &str) -> Result<ShellType> {
        let shell_type = ShellType::from_command(command);

        if Self::is_shell_available(&shell_type) {
            Ok(shell_type)
        } else {
            Err(anyhow::anyhow!(
                "Shell '{}' is not available on this system",
                command
            ))
        }
    }
}

pub struct ShellConfig {
    pub shell_type: ShellType,
    pub command_args: Vec<String>,
    pub environment_vars: HashMap<String, String>,
    pub init_commands: Vec<String>,
}

impl ShellConfig {
    pub fn new(shell_type: ShellType) -> Self {
        let mut command_args = Vec::new();

        // Add interactive args if supported
        if shell_type.supports_interactive_mode() {
            command_args.extend(shell_type.get_interactive_args());
        }

        Self {
            environment_vars: shell_type.get_environment_variables(),
            init_commands: shell_type.get_init_commands(),
            command_args,
            shell_type,
        }
    }

    pub fn get_full_command(&self) -> (String, Vec<String>) {
        (
            self.shell_type.get_command_path().to_string(),
            self.command_args.clone(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_type_from_command() {
        assert_eq!(ShellType::from_command("bash"), ShellType::Bash);
        assert_eq!(ShellType::from_command("/bin/bash"), ShellType::Bash);
        assert_eq!(
            ShellType::from_command("/usr/local/bin/zsh"),
            ShellType::Zsh
        );
        assert_eq!(ShellType::from_command("fish"), ShellType::Fish);
        assert_eq!(ShellType::from_command("nu"), ShellType::Nushell);
    }

    #[test]
    fn test_shell_environment_variables() {
        let bash_env = ShellType::Bash.get_environment_variables();
        assert!(bash_env.contains_key("SHELL"));
        assert_eq!(bash_env.get("TERM"), Some(&"xterm-256color".to_string()));
    }

    #[test]
    fn test_shell_config() {
        let config = ShellConfig::new(ShellType::Zsh);
        assert_eq!(config.shell_type, ShellType::Zsh);
        assert!(!config.init_commands.is_empty());
        assert!(config.environment_vars.contains_key("TERM"));
    }
}

