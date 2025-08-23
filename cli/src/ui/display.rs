use crossterm::{
    cursor,
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
    terminal::{Clear, ClearType},
};
use std::io;

/// Handles all display and UI operations
pub struct DisplayManager;

impl DisplayManager {
    pub fn print_banner() {
        execute!(
            io::stdout(),
            Clear(ClearType::All),
            cursor::MoveTo(0, 0),
            SetForegroundColor(Color::Blue),
            Print("╭─────────────────────────────────────────────╮\n"),
            Print("│           🌐 Iroh Code Remote              │\n"),
            Print("│      P2P Terminal Session Sharing          │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )
        .ok();
    }

    pub fn print_session_info(
        session_id: &str,
        shell_name: &str,
        shell_command: &str,
        width: u16,
        height: u16,
    ) {
        println!("🚀 Starting shared terminal session...");
        println!("📋 Session ID: {}", session_id);
        println!("🐚 Shell: {} ({})", shell_name, shell_command);
        println!("📏 Size: {}x{}", width, height);
        println!();
    }

    pub fn print_network_info(node_id: &str, node_addr: Option<&str>) {
        println!("🌐 Node ID: {}", node_id);
        if let Some(addr) = node_addr {
            println!("📍 Node Address: {}", addr);
        }
    }

    pub fn print_join_info(ticket: &str) {
        println!("💡 Join using: {}", ticket);
    }

    pub fn print_success_message(message: &str) {
        execute!(
            io::stdout(),
            SetForegroundColor(Color::Green),
            Print(format!("✅ {}\n", message)),
            ResetColor
        )
        .ok();
    }

    pub fn print_error_message(message: &str) {
        execute!(
            io::stdout(),
            SetForegroundColor(Color::Red),
            Print(format!("❌ {}\n", message)),
            ResetColor
        )
        .ok();
    }

    pub fn print_warning_message(message: &str) {
        execute!(
            io::stdout(),
            SetForegroundColor(Color::Yellow),
            Print(format!("⚠️  {}\n", message)),
            ResetColor
        )
        .ok();
    }

    pub fn print_info_message(message: &str) {
        execute!(
            io::stdout(),
            SetForegroundColor(Color::Cyan),
            Print(format!("ℹ️  {}\n", message)),
            ResetColor
        )
        .ok();
    }

    pub fn print_session_ended() {
        println!("\n👋 Session ended.");
    }

    pub fn print_saving_session(path: &str) {
        println!("💾 Saving session to: {}", path);
    }

    pub fn print_playback_info(event_count: usize) {
        println!(
            "📺 Starting playback of {} events. Press Ctrl+C to stop.",
            event_count
        );
        println!("⏯️  Press any key to start...");
    }
}