use serde::{Deserialize, Serialize};

/// Crossterm终端上下文信息（与CLI端保持一致）
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

pub struct CrosstermContextProcessor;

impl CrosstermContextProcessor {
    /// 生成上下文摘要用于显示
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

    /// 格式化上下文信息为用户友好的显示格式
    pub fn format_context_display(context: &CrosstermContext) -> String {
        let mut display = String::new();

        // 终端基本信息
        display.push_str(&format!(
            "🖥️  Terminal: {} ({}x{})\n",
            context.terminal_info.terminal_type,
            context.terminal_info.size.0,
            context.terminal_info.size.1
        ));

        if let Some(title) = &context.terminal_info.title {
            display.push_str(&format!("📝 Title: {}\n", title));
        }

        // 颜色支持
        display.push_str(&format!(
            "🎨 Colors: {} colors{}\n",
            context.terminal_capabilities.color_count,
            if context.color_config.supports_truecolor {
                " (RGB supported)"
            } else {
                ""
            }
        ));

        // 终端特性
        let mut features = Vec::new();
        if context.terminal_info.supports_rgb {
            features.push("RGB Colors");
        }
        if context.terminal_info.supports_bracketed_paste {
            features.push("Bracketed Paste");
        }
        if context.terminal_capabilities.supports_cursor_shape {
            features.push("Cursor Shapes");
        }
        if context.terminal_capabilities.supports_mouse {
            features.push("Mouse Events");
        }
        if context.keyboard_config.enhanced_keyboard {
            features.push("Enhanced Keyboard");
        }
        if context.terminal_capabilities.supports_kitty_protocol {
            features.push("Kitty Protocol");
        }

        if !features.is_empty() {
            display.push_str(&format!("✨ Features: {}\n", features.join(", ")));
        }

        // 光标配置
        display.push_str(&format!(
            "🖱️  Cursor: {:?}{}",
            context.cursor_config.shape,
            if context.cursor_config.visible {
                " (visible)"
            } else {
                " (hidden)"
            }
        ));

        if context.cursor_config.blinking {
            display.push_str(", blinking");
        }
        display.push('\n');

        display
    }

    /// 应用终端上下文到当前环境（在移动端可能需要特殊处理）
    pub fn apply_context_to_environment(context: &CrosstermContext) -> Result<(), String> {
        // 在移动端，我们主要是记录这些信息，而不是直接应用
        // 因为移动端的终端环境是模拟的

        // 这里可以根据需要更新UI组件的配置
        // 比如调整颜色主题、终端大小等

        println!(
            "📱 Applied terminal context: {}",
            Self::generate_context_summary(context)
        );

        Ok(())
    }

    /// 检查两个上下文的兼容性
    pub fn check_compatibility(
        local_context: Option<&CrosstermContext>,
        remote_context: &CrosstermContext,
    ) -> Vec<String> {
        let mut warnings = Vec::new();

        if let Some(local) = local_context {
            // 检查颜色支持差异
            if local.terminal_capabilities.color_count
                != remote_context.terminal_capabilities.color_count
            {
                warnings.push(format!(
                    "Color support differs: local {} vs remote {} colors",
                    local.terminal_capabilities.color_count,
                    remote_context.terminal_capabilities.color_count
                ));
            }

            // 检查终端大小差异
            if local.terminal_info.size != remote_context.terminal_info.size {
                warnings.push(format!(
                    "Terminal size differs: local {}x{} vs remote {}x{}",
                    local.terminal_info.size.0,
                    local.terminal_info.size.1,
                    remote_context.terminal_info.size.0,
                    remote_context.terminal_info.size.1
                ));
            }

            // 检查特殊功能差异
            if local.terminal_info.supports_rgb != remote_context.terminal_info.supports_rgb {
                warnings.push("RGB color support differs between terminals".to_string());
            }

            if local.keyboard_config.enhanced_keyboard
                != remote_context.keyboard_config.enhanced_keyboard
            {
                warnings.push("Enhanced keyboard support differs".to_string());
            }
        }

        warnings
    }
}

