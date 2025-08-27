use anyhow::Result;
use crossterm::{
    cursor,
    event::{self, Event, KeyEvent},
    style::{self, Color},
    terminal::{self, size},
};
use serde::{Deserialize, Serialize};
use std::io;
use tracing::{debug, info, warn};

/// Crossterm终端上下文信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrosstermContext {
    /// 终端基本信息
    pub terminal_info: TerminalInfo,
    /// 终端能力
    pub terminal_capabilities: TerminalCapabilities,
    /// 颜色配置
    pub color_config: ColorConfig,
    /// 光标配置
    pub cursor_config: CursorConfig,
    /// 键盘配置
    pub keyboard_config: KeyboardConfig,
    /// 时间戳
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub size: (u16, u16), // (width, height)
    pub title: Option<String>,
    pub terminal_type: String,
    pub supports_rgb: bool,
    pub supports_bracketed_paste: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalCapabilities {
    pub supports_colors: bool,
    pub color_count: u32, // 16, 256, or 16777216 for RGB
    pub supports_styling: bool,
    pub supports_cursor_shape: bool,
    pub supports_kitty_protocol: bool,
    pub supports_mouse: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorConfig {
    pub foreground: Option<(u8, u8, u8)>,
    pub background: Option<(u8, u8, u8)>,
    pub color_palette: Option<Vec<(u8, u8, u8)>>,
    pub supports_truecolor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorConfig {
    pub shape: CursorShape,
    pub blinking: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CursorShape {
    Block,
    UnderScore,
    Line,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardConfig {
    pub enhanced_keyboard: bool,
    pub focus_events: bool,
    pub bracketed_paste: bool,
    pub mouse_capture: bool,
}

pub struct CrosstermContextDetector;

impl CrosstermContextDetector {
    /// 检测完整的crossterm终端上下文
    pub fn detect_context() -> Result<CrosstermContext> {
        info!("Detecting crossterm terminal context...");

        let terminal_info = Self::detect_terminal_info()?;
        let terminal_capabilities = Self::detect_terminal_capabilities();
        let color_config = Self::detect_color_config();
        let cursor_config = Self::detect_cursor_config();
        let keyboard_config = Self::detect_keyboard_config();

        Ok(CrosstermContext {
            terminal_info,
            terminal_capabilities,
            color_config,
            cursor_config,
            keyboard_config,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        })
    }

    /// 检测终端基本信息
    fn detect_terminal_info() -> Result<TerminalInfo> {
        let size = size().unwrap_or((80, 24));

        // 检测终端类型
        let terminal_type = std::env::var("TERM_PROGRAM")
            .or_else(|_| std::env::var("TERM"))
            .unwrap_or_else(|_| "unknown".to_string());

        // 检测RGB支持
        let supports_rgb = Self::check_rgb_support();

        // 检测bracketed paste支持
        let supports_bracketed_paste = Self::check_bracketed_paste_support();

        // 尝试获取终端标题（这个在某些终端中可能不可用）
        let title = None; // crossterm没有直接获取标题的API

        Ok(TerminalInfo {
            size,
            title,
            terminal_type,
            supports_rgb,
            supports_bracketed_paste,
        })
    }

    /// 检测终端能力
    fn detect_terminal_capabilities() -> TerminalCapabilities {
        let supports_colors = Self::check_color_support();
        let color_count = Self::detect_color_count();
        let supports_styling = true; // crossterm基本都支持样式
        let supports_cursor_shape = Self::check_cursor_shape_support();
        let supports_kitty_protocol = Self::check_kitty_protocol_support();
        let supports_mouse = Self::check_mouse_support();

        TerminalCapabilities {
            supports_colors,
            color_count,
            supports_styling,
            supports_cursor_shape,
            supports_kitty_protocol,
            supports_mouse,
        }
    }

    /// 检测颜色配置
    fn detect_color_config() -> ColorConfig {
        let supports_truecolor = Self::check_rgb_support();

        // 这些值通常需要从终端配置中获取，这里提供默认值
        let foreground = None; // 无法直接从crossterm获取
        let background = None; // 无法直接从crossterm获取
        let color_palette = None; // 无法直接从crossterm获取

        ColorConfig {
            foreground,
            background,
            color_palette,
            supports_truecolor,
        }
    }

    /// 检测光标配置
    fn detect_cursor_config() -> CursorConfig {
        // 默认配置，实际配置可能需要从终端查询
        CursorConfig {
            shape: CursorShape::Block, // 默认块状光标
            blinking: false,           // 无法直接检测
            visible: true,             // 默认可见
        }
    }

    /// 检测键盘配置
    fn detect_keyboard_config() -> KeyboardConfig {
        KeyboardConfig {
            enhanced_keyboard: Self::check_enhanced_keyboard_support(),
            focus_events: Self::check_focus_events_support(),
            bracketed_paste: Self::check_bracketed_paste_support(),
            mouse_capture: Self::check_mouse_support(),
        }
    }

    // 辅助检测方法

    fn check_rgb_support() -> bool {
        // 检查COLORTERM环境变量
        if let Ok(colorterm) = std::env::var("COLORTERM") {
            colorterm.contains("truecolor") || colorterm.contains("24bit")
        } else {
            // 检查TERM环境变量
            std::env::var("TERM")
                .map(|term| {
                    term.contains("256color")
                        || term.contains("truecolor")
                        || term == "xterm-kitty"
                        || term == "alacritty"
                })
                .unwrap_or(false)
        }
    }

    fn check_color_support() -> bool {
        // 大部分现代终端都支持颜色
        std::env::var("TERM")
            .map(|term| !term.contains("mono") && term != "dumb")
            .unwrap_or(true)
    }

    fn detect_color_count() -> u32 {
        if Self::check_rgb_support() {
            16777216 // 24位RGB
        } else if std::env::var("TERM")
            .map(|term| term.contains("256color"))
            .unwrap_or(false)
        {
            256
        } else {
            16 // 基本16色
        }
    }

    fn check_cursor_shape_support() -> bool {
        // 大部分现代终端支持光标形状变更
        let term = std::env::var("TERM_PROGRAM").unwrap_or_default();
        matches!(
            term.as_str(),
            "iTerm.app" | "vscode" | "Hyper" | "Alacritty" | "kitty"
        ) || std::env::var("TERM")
            .map(|t| t.contains("xterm") || t.contains("kitty") || t.contains("alacritty"))
            .unwrap_or(false)
    }

    fn check_kitty_protocol_support() -> bool {
        std::env::var("TERM")
            .map(|term| term == "xterm-kitty")
            .unwrap_or(false)
            || std::env::var("KITTY_WINDOW_ID").is_ok()
    }

    fn check_mouse_support() -> bool {
        // 大部分终端都支持鼠标事件
        true
    }

    fn check_enhanced_keyboard_support() -> bool {
        // 检查是否支持增强键盘协议
        Self::check_kitty_protocol_support()
            || std::env::var("TERM_PROGRAM")
                .map(|term| term == "iTerm.app")
                .unwrap_or(false)
    }

    fn check_focus_events_support() -> bool {
        // 大部分现代终端支持焦点事件
        !std::env::var("TERM")
            .map(|term| term == "dumb")
            .unwrap_or(false)
    }

    fn check_bracketed_paste_support() -> bool {
        // 大部分现代终端支持bracketed paste
        let term = std::env::var("TERM").unwrap_or_default();
        !matches!(term.as_str(), "dumb" | "unknown")
    }

    /// 生成上下文摘要
    pub fn generate_context_summary(context: &CrosstermContext) -> String {
        format!(
            "{}-{}x{}-{}colors-{}",
            context.terminal_info.terminal_type,
            context.terminal_info.size.0,
            context.terminal_info.size.1,
            context.terminal_capabilities.color_count,
            if context.color_config.supports_truecolor {
                "truecolor"
            } else {
                "basic"
            }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_context() {
        let context = CrosstermContextDetector::detect_context();
        assert!(context.is_ok());

        let ctx = context.unwrap();
        assert!(ctx.terminal_info.size.0 > 0);
        assert!(ctx.terminal_info.size.1 > 0);
        assert!(ctx.timestamp > 0);
    }

    #[test]
    fn test_context_summary() {
        let context = CrosstermContext {
            terminal_info: TerminalInfo {
                size: (120, 30),
                title: None,
                terminal_type: "iTerm2".to_string(),
                supports_rgb: true,
                supports_bracketed_paste: true,
            },
            terminal_capabilities: TerminalCapabilities {
                supports_colors: true,
                color_count: 16777216,
                supports_styling: true,
                supports_cursor_shape: true,
                supports_kitty_protocol: false,
                supports_mouse: true,
            },
            color_config: ColorConfig {
                foreground: None,
                background: None,
                color_palette: None,
                supports_truecolor: true,
            },
            cursor_config: CursorConfig {
                shape: CursorShape::Block,
                blinking: false,
                visible: true,
            },
            keyboard_config: KeyboardConfig {
                enhanced_keyboard: false,
                focus_events: true,
                bracketed_paste: true,
                mouse_capture: true,
            },
            timestamp: 1234567890,
        };

        let summary = CrosstermContextDetector::generate_context_summary(&context);
        assert_eq!(summary, "iTerm2-120x30-16777216colors-truecolor");
    }
}

