use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{debug, info, warn};

#[derive(Debug, Clone)]
pub struct ZshConfig {
    pub zdotdir: PathBuf,
    pub zshrc_path: PathBuf,
    pub has_oh_my_zsh: bool,
    pub oh_my_zsh_path: Option<PathBuf>,
    pub plugins: Vec<String>,
    pub theme: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FishConfig {
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub functions_dir: Option<PathBuf>,
    pub completions_dir: Option<PathBuf>,
    pub conf_d_dir: Option<PathBuf>,
    pub variables: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct NushellConfig {
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub env_file: Option<PathBuf>,
    pub startup_commands: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PowerShellConfig {
    pub profile_path: Option<PathBuf>,
    pub config_dir: Option<PathBuf>,
    pub modules: Vec<String>,
}

impl ZshConfig {
    pub fn detect() -> Option<Self> {
        let home_dir = env::var("HOME").ok()?;
        let zdotdir = env::var("ZDOTDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(&home_dir));

        let zshrc_path = zdotdir.join(".zshrc");
        if !zshrc_path.exists() {
            warn!("~/.zshrc not found, zsh may not work properly");
            return None;
        }

        info!("Found zsh configuration at: {}", zshrc_path.display());

        // Read .zshrc to extract configuration
        let zshrc_content = fs::read_to_string(&zshrc_path).ok()?;

        // Check for oh-my-zsh
        let oh_my_zsh_path = Self::detect_oh_my_zsh(&zshrc_content, &home_dir);
        let has_oh_my_zsh = oh_my_zsh_path.is_some();

        // Extract plugins
        let plugins = Self::extract_plugins(&zshrc_content);

        // Extract theme
        let theme = Self::extract_theme(&zshrc_content);

        Some(ZshConfig {
            zdotdir,
            zshrc_path,
            has_oh_my_zsh,
            oh_my_zsh_path,
            plugins,
            theme,
        })
    }

    fn detect_oh_my_zsh(zshrc_content: &str, home_dir: &str) -> Option<PathBuf> {
        // Look for ZSH= export in .zshrc
        for line in zshrc_content.lines() {
            if line.trim_start().starts_with("export ZSH=") {
                let path_str = line
                    .split('=')
                    .nth(1)?
                    .trim()
                    .trim_matches('"')
                    .replace("$HOME", home_dir);
                let path = PathBuf::from(path_str);
                if path.exists() {
                    info!("Found oh-my-zsh at: {}", path.display());
                    return Some(path);
                }
            }
        }

        // Check default locations
        let default_paths = [
            format!("{}/.oh-my-zsh", home_dir),
            format!("{}/oh-my-zsh", home_dir),
        ];

        for path_str in &default_paths {
            let path = PathBuf::from(path_str);
            if path.exists() {
                info!("Found oh-my-zsh at default location: {}", path.display());
                return Some(path);
            }
        }

        None
    }

    fn extract_plugins(zshrc_content: &str) -> Vec<String> {
        for line in zshrc_content.lines() {
            let line = line.trim();
            if line.starts_with("plugins=(") {
                // Extract plugins from plugins=(git zsh-autosuggestions zsh-syntax-highlighting)
                let plugins_str = line
                    .strip_prefix("plugins=(")
                    .and_then(|s| s.strip_suffix(")"))
                    .unwrap_or("");

                let plugins: Vec<String> = plugins_str
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();

                info!("Found plugins: {:?}", plugins);
                return plugins;
            }
        }
        Vec::new()
    }

    fn extract_theme(zshrc_content: &str) -> Option<String> {
        for line in zshrc_content.lines() {
            let line = line.trim();
            if line.starts_with("ZSH_THEME=") {
                let theme = line
                    .strip_prefix("ZSH_THEME=")
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                info!("Found theme: {}", theme);
                return Some(theme);
            }
        }
        None
    }

    pub fn get_environment_variables(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // Set ZDOTDIR if different from HOME
        if let Ok(home) = env::var("HOME") {
            if self.zdotdir != PathBuf::from(&home) {
                env_vars.insert(
                    "ZDOTDIR".to_string(),
                    self.zdotdir.to_string_lossy().to_string(),
                );
            }
        }

        // Set ZSH path for oh-my-zsh
        if let Some(ref oh_my_zsh_path) = self.oh_my_zsh_path {
            env_vars.insert(
                "ZSH".to_string(),
                oh_my_zsh_path.to_string_lossy().to_string(),
            );
        }

        env_vars
    }
}

impl FishConfig {
    pub fn detect() -> Option<Self> {
        let home_dir = env::var("HOME").ok()?;
        let config_dir = PathBuf::from(&home_dir).join(".config").join("fish");

        if !config_dir.exists() {
            debug!("Fish config directory not found");
            return None;
        }

        let config_file = config_dir.join("config.fish");
        if !config_file.exists() {
            debug!("Fish config.fish not found");
            return None;
        }

        info!("Found Fish configuration at: {}", config_file.display());

        let functions_dir = config_dir.join("functions");
        let completions_dir = config_dir.join("completions");
        let conf_d_dir = config_dir.join("conf.d");

        // Read fish variables if available
        let mut variables = HashMap::new();
        if let Ok(fish_vars) = fs::read_to_string(config_dir.join("fish_variables")) {
            for line in fish_vars.lines() {
                if line.starts_with("SETUVAR ") {
                    if let Some((key, value)) = line
                        .strip_prefix("SETUVAR ")
                        .and_then(|s| s.split_once(':'))
                    {
                        variables.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }

        Some(FishConfig {
            config_dir,
            config_file,
            functions_dir: if functions_dir.exists() {
                Some(functions_dir)
            } else {
                None
            },
            completions_dir: if completions_dir.exists() {
                Some(completions_dir)
            } else {
                None
            },
            conf_d_dir: if conf_d_dir.exists() {
                Some(conf_d_dir)
            } else {
                None
            },
            variables,
        })
    }

    pub fn get_environment_variables(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // Set Fish-specific environment variables
        env_vars.insert("SHELL".to_string(), "fish".to_string());

        // Add user variables
        for (key, value) in &self.variables {
            env_vars.insert(key.clone(), value.clone());
        }

        env_vars
    }
}

impl NushellConfig {
    pub fn detect() -> Option<Self> {
        let home_dir = env::var("HOME").ok()?;
        let config_dir = PathBuf::from(&home_dir).join(".config").join("nushell");

        if !config_dir.exists() {
            debug!("Nushell config directory not found");
            return None;
        }

        let config_file = config_dir.join("config.nu");
        if !config_file.exists() {
            debug!("Nushell config.nu not found");
            return None;
        }

        info!("Found Nushell configuration at: {}", config_file.display());

        let env_file = config_dir.join("env.nu");
        let env_file = if env_file.exists() {
            Some(env_file)
        } else {
            None
        };

        // Read startup commands from config.nu
        let mut startup_commands = Vec::new();
        if let Ok(config_content) = fs::read_to_string(&config_file) {
            for line in config_content.lines() {
                let line = line.trim();
                if line.starts_with("source ") {
                    startup_commands.push(line.to_string());
                }
            }
        }

        Some(NushellConfig {
            config_dir,
            config_file,
            env_file,
            startup_commands,
        })
    }

    pub fn get_environment_variables(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();
        env_vars.insert("SHELL".to_string(), "nu".to_string());
        env_vars
    }
}

impl PowerShellConfig {
    pub fn detect() -> Option<Self> {
        // Try to detect PowerShell configuration
        let home_dir = env::var("HOME").ok()?;

        // Common PowerShell profile locations
        let possible_profiles = [
            PathBuf::from(&home_dir)
                .join(".config")
                .join("powershell")
                .join("Microsoft.PowerShell_profile.ps1"),
            PathBuf::from(&home_dir)
                .join("Documents")
                .join("PowerShell")
                .join("Microsoft.PowerShell_profile.ps1"),
            PathBuf::from(&home_dir)
                .join("Documents")
                .join("WindowsPowerShell")
                .join("Microsoft.PowerShell_profile.ps1"),
        ];

        let mut profile_path = None;
        for path in &possible_profiles {
            if path.exists() {
                info!("Found PowerShell profile at: {}", path.display());
                profile_path = Some(path.clone());
                break;
            }
        }

        let config_dir = PathBuf::from(&home_dir).join(".config").join("powershell");
        let config_dir = if config_dir.exists() {
            Some(config_dir)
        } else {
            None
        };

        Some(PowerShellConfig {
            profile_path,
            config_dir,
            modules: Vec::new(), // TODO: Parse modules from profile
        })
    }

    pub fn get_environment_variables(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();
        env_vars.insert("SHELL".to_string(), "pwsh".to_string());
        env_vars
    }
}

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

                // Load user's zsh configuration if available
                if let Some(zsh_config) = ZshConfig::detect() {
                    info!(
                        "Loading user's zsh configuration with {} plugins",
                        zsh_config.plugins.len()
                    );

                    // Merge zsh-specific environment variables
                    for (key, value) in zsh_config.get_environment_variables() {
                        env_vars.insert(key, value);
                    }
                } else {
                    // Fallback to basic configuration
                    env_vars.insert(
                        "ZDOTDIR".to_string(),
                        env::var("ZDOTDIR").unwrap_or_else(|_| "~".to_string()),
                    );
                }
            }
            ShellType::Fish => {
                env_vars.insert("SHELL".to_string(), "/usr/bin/fish".to_string());

                // Load user's fish configuration if available
                if let Some(fish_config) = FishConfig::detect() {
                    info!("Loading user's Fish configuration");

                    // Merge fish-specific environment variables
                    for (key, value) in fish_config.get_environment_variables() {
                        env_vars.insert(key, value);
                    }

                    // Set fish config directory
                    env_vars.insert(
                        "FISH_CONFIG_DIR".to_string(),
                        fish_config.config_dir.to_string_lossy().to_string(),
                    );
                }
            }
            ShellType::Nushell => {
                env_vars.insert("SHELL".to_string(), "/usr/bin/nu".to_string());

                // Load user's nushell configuration if available
                if let Some(nu_config) = NushellConfig::detect() {
                    info!(
                        "Loading user's Nushell configuration with {} startup commands",
                        nu_config.startup_commands.len()
                    );

                    // Merge nushell-specific environment variables
                    for (key, value) in nu_config.get_environment_variables() {
                        env_vars.insert(key, value);
                    }

                    // Set nushell config directory
                    env_vars.insert(
                        "NU_CONFIG_DIR".to_string(),
                        nu_config.config_dir.to_string_lossy().to_string(),
                    );
                }
            }
            ShellType::PowerShell => {
                env_vars.insert("SHELL".to_string(), "pwsh".to_string());

                // Load user's PowerShell configuration if available
                if let Some(ps_config) = PowerShellConfig::detect() {
                    info!("Loading user's PowerShell configuration");

                    // Merge PowerShell-specific environment variables
                    for (key, value) in ps_config.get_environment_variables() {
                        env_vars.insert(key, value);
                    }

                    if let Some(profile_path) = &ps_config.profile_path {
                        env_vars.insert(
                            "POWERSHELL_PROFILE".to_string(),
                            profile_path.to_string_lossy().to_string(),
                        );
                    }
                }
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
            ShellType::Zsh => {
                if let Some(zsh_config) = ZshConfig::detect() {
                    let mut commands = vec![];

                    // Instead of custom PS1, let zsh use the user's configuration
                    commands.push("echo '🐚 Zsh shell initialized in riterm session with user configuration'".to_string());

                    if zsh_config.has_oh_my_zsh {
                        commands.push(format!("echo '  📦 oh-my-zsh detected with {} plugins'", zsh_config.plugins.len()));
                        if let Some(theme) = &zsh_config.theme {
                            commands.push(format!("echo '  🎨 Theme: {}'", theme));
                        }
                        if !zsh_config.plugins.is_empty() {
                            commands.push(format!("echo '  🔌 Plugins: {}'", zsh_config.plugins.join(", ")));
                        }
                    }

                    commands
                } else {
                    // Fallback to basic zsh initialization
                    vec![
                        "autoload -U colors && colors".to_string(),
                        "export PS1='%{$fg[green]%}%n@%m%{$reset_color%}:%{$fg[blue]%}%~%{$reset_color%}$ '".to_string(),
                        "echo '🐚 Zsh shell initialized in riterm session (basic configuration)'".to_string(),
                    ]
                }
            }
            ShellType::Fish => {
                if let Some(fish_config) = FishConfig::detect() {
                    let mut commands = vec![];

                    commands.push("echo '🐚 Fish shell initialized in riterm session with user configuration'".to_string());

                    if let Some(_functions_dir) = &fish_config.functions_dir {
                        commands.push("echo '  📁 Custom functions directory found'".to_string());
                    }

                    if let Some(_completions_dir) = &fish_config.completions_dir {
                        commands.push("echo '  🔄 Custom completions directory found'".to_string());
                    }

                    if !fish_config.variables.is_empty() {
                        commands.push(format!("echo '  🔧 {} user variables loaded'", fish_config.variables.len()));
                    }

                    commands
                } else {
                    // Fallback to basic fish initialization
                    vec![
                        "set -g fish_greeting '🐚 Fish shell initialized in riterm session (basic configuration)'".to_string(),
                        "function fish_prompt; echo (set_color green)(whoami)'@'(hostname)(set_color normal)':'(set_color blue)(pwd)(set_color normal)'$ '; end".to_string(),
                    ]
                }
            }
            ShellType::Nushell => {
                if let Some(nu_config) = NushellConfig::detect() {
                    let mut commands = vec![];

                    commands.push("echo '🐚 Nushell initialized in riterm session with user configuration'".to_string());

                    if nu_config.env_file.is_some() {
                        commands.push("echo '  🌍 Environment configuration found'".to_string());
                    }

                    if !nu_config.startup_commands.is_empty() {
                        commands.push(format!("echo '  🚀 {} startup commands detected'", nu_config.startup_commands.len()));
                    }

                    commands
                } else {
                    // Fallback to basic nushell initialization
                    vec![
                        "echo '🐚 Nushell initialized in riterm session (basic configuration)'".to_string(),
                    ]
                }
            }
            ShellType::PowerShell => {
                if let Some(ps_config) = PowerShellConfig::detect() {
                    let mut commands = vec![];

                    commands.push("Write-Host '🐚 PowerShell initialized in riterm session with user configuration' -ForegroundColor Green".to_string());

                    if ps_config.profile_path.is_some() {
                        commands.push("Write-Host '  📋 PowerShell profile found' -ForegroundColor Cyan".to_string());
                    }

                    if ps_config.config_dir.is_some() {
                        commands.push("Write-Host '  📁 Configuration directory found' -ForegroundColor Cyan".to_string());
                    }

                    commands
                } else {
                    // Fallback to basic PowerShell initialization
                    vec![
                        "Write-Host '🐚 PowerShell initialized in riterm session (basic configuration)' -ForegroundColor Green".to_string(),
                    ]
                }
            }
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

        // For zsh, ensure we load the user's configuration
        if shell_type == ShellType::Zsh {
            // Remove any existing -i flag and add our custom startup sequence
            command_args.clear();
            command_args.push("-i".to_string());
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
