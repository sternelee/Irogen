use anyhow::Result;
use crossterm::{
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
};
use std::io;
use tracing::info;

use crate::shell::{ShellDetector, ShellType};

pub struct ShellManager;

impl ShellManager {
    pub fn list_available() -> Result<()> {
        println!("🐚 Available Shells:");
        println!();

        let available_shells = ShellDetector::detect_available_shells();
        let current_shell = ShellDetector::get_current_shell();

        if available_shells.is_empty() {
            println!("❌ No supported shells found on this system");
            return Ok(());
        }

        for (index, shell) in available_shells.iter().enumerate() {
            let is_current = current_shell.as_ref() == Some(shell);
            let marker = if is_current { "→" } else { " " };
            let status = if is_current { " (current)" } else { "" };

            execute!(
                io::stdout(),
                SetForegroundColor(if is_current {
                    Color::Green
                } else {
                    Color::Cyan
                }),
                Print(format!(
                    "{}{}. {} - {}{}\n",
                    marker,
                    index + 1,
                    shell.get_display_name(),
                    shell.get_command_path(),
                    status
                )),
                ResetColor
            )?;
        }

        println!();
        println!(
            "💡 Use --shell <name> to specify a shell, or let the system detect automatically"
        );

        Ok(())
    }

    pub fn get_shell_info(shell_type: &ShellType) -> ShellInfo {
        let available = ShellDetector::is_shell_available(shell_type.get_command_path());
        let path = ShellDetector::find_shell_path(shell_type.get_command_path())
            .unwrap_or_else(|_| "Not found".to_string());

        let features = match shell_type {
            ShellType::Zsh => vec![
                "oh-my-zsh support",
                "plugins",
                "themes",
                "advanced completion",
            ],
            ShellType::Bash => vec!["POSIX compatible", "readline support", "history", "aliases"],
            ShellType::Fish => vec![
                "user-friendly",
                "syntax highlighting",
                "autosuggestions",
                "web configuration",
            ],
            ShellType::Nushell => vec![
                "structured data",
                "modern syntax",
                "built-in commands",
                "cross-platform",
            ],
            ShellType::PowerShell => vec![
                ".NET integration",
                "object-based pipes",
                "modules",
                "cross-platform",
            ],
            _ => vec![],
        };

        ShellInfo {
            shell_type: shell_type.clone(),
            display_name: shell_type.get_display_name().to_string(),
            command_path: shell_type.get_command_path().to_string(),
            full_path: path,
            available,
            features: features.into_iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn detect_and_display_current() -> Result<()> {
        info!("Detecting current shell configuration...");

        let current_shell = ShellDetector::get_current_shell()
            .unwrap_or_else(|| ShellDetector::get_default_shell());

        let shell_info = Self::get_shell_info(&current_shell);

        println!("🐚 Current Shell Information:");
        println!("   Name: {}", shell_info.display_name);
        println!("   Command: {}", shell_info.command_path);
        println!("   Full Path: {}", shell_info.full_path);
        println!(
            "   Available: {}",
            if shell_info.available {
                "✅ Yes"
            } else {
                "❌ No"
            }
        );

        if !shell_info.features.is_empty() {
            println!("   Features: {}", shell_info.features.join(", "));
        }

        println!();

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct ShellInfo {
    pub shell_type: ShellType,
    pub display_name: String,
    pub command_path: String,
    pub full_path: String,
    pub available: bool,
    pub features: Vec<String>,
}
