use anyhow::Result;
use crossterm;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use tracing::{debug, info};

use crate::shell::{ShellDetector, ShellType};

/// 终端配置信息，包含终端类型、shell配置和环境信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfigInfo {
    /// 当前终端类型
    pub terminal_type: String,
    /// 当前shell类型和配置
    pub shell_config: ShellConfigInfo,
    /// 终端尺寸
    pub terminal_size: TerminalSize,
    /// 环境变量
    pub environment: HashMap<String, String>,
    /// 系统信息
    pub system_info: SystemInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfigInfo {
    pub shell_type: String,
    pub shell_path: String,
    pub config_files: Vec<String>,
    pub plugins: Vec<String>,
    pub theme: Option<String>,
    pub aliases: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSize {
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub hostname: String,
    pub username: String,
    pub working_directory: String,
}

pub struct TerminalConfigDetector;

impl TerminalConfigDetector {
    /// 检测完整的终端配置信息
    pub fn detect_full_config() -> Result<TerminalConfigInfo> {
        info!("Detecting full terminal configuration...");

        let terminal_type = Self::detect_terminal_type();
        let shell_config = Self::detect_shell_config()?;
        let terminal_size = Self::detect_terminal_size();
        let environment = Self::collect_relevant_environment();
        let system_info = Self::collect_system_info()?;

        Ok(TerminalConfigInfo {
            terminal_type,
            shell_config,
            terminal_size,
            environment,
            system_info,
        })
    }

    /// 检测终端类型
    fn detect_terminal_type() -> String {
        // 检查常见的终端环境变量
        if let Ok(term_program) = env::var("TERM_PROGRAM") {
            match term_program.as_str() {
                "iTerm.app" => return "iTerm2".to_string(),
                "Apple_Terminal" => return "Terminal.app".to_string(),
                "vscode" => return "VSCode".to_string(),
                _ => {}
            }
        }

        if let Ok(term) = env::var("TERM") {
            match term.as_str() {
                "xterm-kitty" => return "Kitty".to_string(),
                "alacritty" => return "Alacritty".to_string(),
                "tmux-256color" => return "Tmux".to_string(),
                "screen" | "screen-256color" => return "Screen".to_string(),
                _ => {}
            }
        }

        // 检查其他终端特定的环境变量
        if env::var("KITTY_WINDOW_ID").is_ok() {
            return "Kitty".to_string();
        }

        if env::var("ALACRITTY_SOCKET").is_ok() {
            return "Alacritty".to_string();
        }

        if env::var("TMUX").is_ok() {
            return "Tmux".to_string();
        }

        if env::var("WEZTERM_EXECUTABLE").is_ok() {
            return "WezTerm".to_string();
        }

        // 默认返回通用终端类型
        env::var("TERM").unwrap_or_else(|_| "Unknown".to_string())
    }

    /// 检测shell配置
    fn detect_shell_config() -> Result<ShellConfigInfo> {
        let current_shell = ShellDetector::get_current_shell()
            .unwrap_or_else(|| ShellDetector::get_default_shell());

        let shell_path = ShellDetector::find_shell_path(current_shell.get_command_path())
            .unwrap_or_else(|_| current_shell.get_command_path().to_string());

        let config_files = Self::detect_shell_config_files(&current_shell)?;
        let (plugins, theme) =
            Self::extract_shell_plugins_and_theme(&current_shell, &config_files)?;
        let aliases = Self::extract_shell_aliases(&current_shell, &config_files)?;

        Ok(ShellConfigInfo {
            shell_type: current_shell.get_display_name().to_string(),
            shell_path,
            config_files,
            plugins,
            theme,
            aliases,
        })
    }

    /// 检测shell配置文件
    fn detect_shell_config_files(shell_type: &ShellType) -> Result<Vec<String>> {
        let home_dir = env::var("HOME")?;
        let mut config_files = Vec::new();

        match shell_type {
            ShellType::Bash => {
                let possible_files = [
                    format!("{}/.bashrc", home_dir),
                    format!("{}/.bash_profile", home_dir),
                    format!("{}/.profile", home_dir),
                ];
                for file_path in &possible_files {
                    if fs::metadata(file_path).is_ok() {
                        config_files.push(file_path.clone());
                    }
                }
            }
            ShellType::Zsh => {
                let zdotdir = env::var("ZDOTDIR").unwrap_or_else(|_| home_dir.clone());
                let possible_files = [
                    format!("{}/.zshrc", zdotdir),
                    format!("{}/.zprofile", zdotdir),
                    format!("{}/.zshenv", zdotdir),
                ];
                for file_path in &possible_files {
                    if fs::metadata(file_path).is_ok() {
                        config_files.push(file_path.clone());
                    }
                }
            }
            ShellType::Fish => {
                let config_dir = format!("{}/.config/fish", home_dir);
                let possible_files = [
                    format!("{}/config.fish", config_dir),
                    format!("{}/fish_variables", config_dir),
                ];
                for file_path in &possible_files {
                    if fs::metadata(file_path).is_ok() {
                        config_files.push(file_path.clone());
                    }
                }
            }
            ShellType::Nushell => {
                let config_dir = format!("{}/.config/nushell", home_dir);
                let possible_files = [
                    format!("{}/config.nu", config_dir),
                    format!("{}/env.nu", config_dir),
                ];
                for file_path in &possible_files {
                    if fs::metadata(file_path).is_ok() {
                        config_files.push(file_path.clone());
                    }
                }
            }
            _ => {
                debug!(
                    "No specific config file detection for shell: {:?}",
                    shell_type
                );
            }
        }

        Ok(config_files)
    }

    /// 提取shell插件和主题
    fn extract_shell_plugins_and_theme(
        shell_type: &ShellType,
        config_files: &[String],
    ) -> Result<(Vec<String>, Option<String>)> {
        let mut plugins = Vec::new();
        let mut theme = None;

        match shell_type {
            ShellType::Zsh => {
                for config_file in config_files {
                    if config_file.ends_with(".zshrc") {
                        if let Ok(content) = fs::read_to_string(config_file) {
                            // 提取oh-my-zsh插件
                            for line in content.lines() {
                                let line = line.trim();
                                if line.starts_with("plugins=(") {
                                    if let Some(plugins_str) = line
                                        .strip_prefix("plugins=(")
                                        .and_then(|s| s.strip_suffix(")"))
                                    {
                                        plugins.extend(
                                            plugins_str.split_whitespace().map(|s| s.to_string()),
                                        );
                                    }
                                }
                                if line.starts_with("ZSH_THEME=") {
                                    theme = line
                                        .strip_prefix("ZSH_THEME=")
                                        .map(|s| s.trim_matches('"').to_string());
                                }
                            }
                        }
                    }
                }
            }
            _ => {
                debug!(
                    "Plugin/theme extraction not implemented for: {:?}",
                    shell_type
                );
            }
        }

        Ok((plugins, theme))
    }

    /// 提取shell别名
    fn extract_shell_aliases(
        shell_type: &ShellType,
        config_files: &[String],
    ) -> Result<HashMap<String, String>> {
        let mut aliases = HashMap::new();

        for config_file in config_files {
            if let Ok(content) = fs::read_to_string(config_file) {
                match shell_type {
                    ShellType::Bash | ShellType::Zsh => {
                        for line in content.lines() {
                            let line = line.trim();
                            if line.starts_with("alias ") {
                                if let Some(alias_def) = line.strip_prefix("alias ") {
                                    if let Some((key, value)) = alias_def.split_once('=') {
                                        aliases.insert(
                                            key.to_string(),
                                            value.trim_matches('"').trim_matches('\'').to_string(),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    ShellType::Fish => {
                        // Fish使用不同的别名语法
                        for line in content.lines() {
                            let line = line.trim();
                            if line.starts_with("alias ") {
                                // Fish: alias name "command"
                                let parts: Vec<&str> = line.split_whitespace().collect();
                                if parts.len() >= 3 {
                                    aliases.insert(
                                        parts[1].to_string(),
                                        parts[2..].join(" ").trim_matches('"').to_string(),
                                    );
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok(aliases)
    }

    /// 检测终端尺寸
    fn detect_terminal_size() -> TerminalSize {
        // 尝试从环境变量获取
        let width = env::var("COLUMNS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                // 使用crossterm获取终端尺寸
                crossterm::terminal::size().map(|(w, _)| w).unwrap_or(80)
            });

        let height = env::var("LINES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                // 使用crossterm获取终端尺寸
                crossterm::terminal::size().map(|(_, h)| h).unwrap_or(24)
            });

        TerminalSize { width, height }
    }

    /// 收集相关环境变量
    fn collect_relevant_environment() -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // 收集终端相关的环境变量
        let relevant_vars = [
            "TERM",
            "TERM_PROGRAM",
            "TERM_PROGRAM_VERSION",
            "COLORTERM",
            "SHELL",
            "ZDOTDIR",
            "PATH",
            "HOME",
            "USER",
            "USERNAME",
            "PWD",
            "OLDPWD",
            "LANG",
            "LC_ALL",
            "TMUX",
            "KITTY_WINDOW_ID",
            "ALACRITTY_SOCKET",
            "WEZTERM_EXECUTABLE",
            "ITERM_SESSION_ID",
            "VSCODE_INJECTION",
        ];

        for var in &relevant_vars {
            if let Ok(value) = env::var(var) {
                env_vars.insert(var.to_string(), value);
            }
        }

        env_vars
    }

    /// 收集系统信息
    fn collect_system_info() -> Result<SystemInfo> {
        let os = if cfg!(target_os = "macos") {
            "macOS".to_string()
        } else if cfg!(target_os = "linux") {
            "Linux".to_string()
        } else if cfg!(target_os = "windows") {
            "Windows".to_string()
        } else {
            "Unknown".to_string()
        };

        let arch = if cfg!(target_arch = "x86_64") {
            "x86_64".to_string()
        } else if cfg!(target_arch = "aarch64") {
            "aarch64".to_string()
        } else {
            env::consts::ARCH.to_string()
        };

        let hostname = env::var("HOSTNAME")
            .or_else(|_| env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "unknown".to_string());

        let username = env::var("USER")
            .or_else(|_| env::var("USERNAME"))
            .unwrap_or_else(|_| "unknown".to_string());

        let working_directory = env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("~"))
            .to_string_lossy()
            .to_string();

        Ok(SystemInfo {
            os,
            arch,
            hostname,
            username,
            working_directory,
        })
    }

    /// 生成配置摘要用于快速比较
    pub fn generate_config_summary(config: &TerminalConfigInfo) -> String {
        format!(
            "{}-{}-{}-{}x{}",
            config.terminal_type,
            config.shell_config.shell_type,
            config.system_info.os,
            config.terminal_size.width,
            config.terminal_size.height
        )
    }

    /// 检查两个配置是否兼容
    pub fn configs_compatible(config1: &TerminalConfigInfo, config2: &TerminalConfigInfo) -> bool {
        // 基本兼容性检查
        config1.shell_config.shell_type == config2.shell_config.shell_type
            && config1.system_info.os == config2.system_info.os
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_terminal_type() {
        let terminal_type = TerminalConfigDetector::detect_terminal_type();
        assert!(!terminal_type.is_empty());
    }

    #[test]
    fn test_detect_terminal_size() {
        let size = TerminalConfigDetector::detect_terminal_size();
        assert!(size.width > 0);
        assert!(size.height > 0);
    }

    #[test]
    fn test_config_summary_generation() {
        let config = TerminalConfigInfo {
            terminal_type: "iTerm2".to_string(),
            shell_config: ShellConfigInfo {
                shell_type: "zsh".to_string(),
                shell_path: "/bin/zsh".to_string(),
                config_files: vec![],
                plugins: vec![],
                theme: None,
                aliases: HashMap::new(),
            },
            terminal_size: TerminalSize {
                width: 120,
                height: 30,
            },
            environment: HashMap::new(),
            system_info: SystemInfo {
                os: "macOS".to_string(),
                arch: "aarch64".to_string(),
                hostname: "test".to_string(),
                username: "user".to_string(),
                working_directory: "/home/user".to_string(),
            },
        };

        let summary = TerminalConfigDetector::generate_config_summary(&config);
        assert_eq!(summary, "iTerm2-zsh-macOS-120x30");
    }
}
