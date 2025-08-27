# Crossterm终端上下文传输设计方案

## 数据结构设计

```rust
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
    pub color_count: u16, // 16, 256, or 16777216 for RGB
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
```

## 消息类型扩展

```rust
pub enum TerminalMessageBody {
    // ... 现有的消息类型
    
    /// 发送crossterm终端上下文
    CrosstermContext {
        from: NodeId,
        context: CrosstermContext,
        session_id: String,
    },
    
    /// 请求终端上下文
    RequestContext {
        from: NodeId,
        session_id: String,
    },
}
```

## 实现流程

### 1. CLI Host发送流程
```
新参与者加入 -> 检测终端上下文 -> 序列化上下文数据 -> 加密发送
```

### 2. 远程App接收流程
```
接收上下文消息 -> 解密数据 -> 反序列化 -> 应用终端配置 -> 更新UI
```

## 触发时机

1. **主动发送**: 当有新的远程app加入会话时自动发送
2. **请求响应**: 远程app可以主动请求最新的终端上下文
3. **配置变更**: 当CLI host的终端配置发生变化时广播更新

## 安全性

- 复用现有的ChaCha20Poly1305加密机制
- 会话级别的访问控制
- 包含发送者节点ID验证

## 兼容性

- 向后兼容现有消息格式
- 可选的上下文信息，不影响基本功能
- 支持降级处理（如果远程不支持某些特性）