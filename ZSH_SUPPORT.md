# Enhanced Zsh Support for riterm

riterm 现在完全支持用户的 zsh 配置，包括 oh-my-zsh 框架和所有插件！

## 🚀 新增功能

### 自动配置检测

- 自动检测 `~/.zshrc`, `~/.zshenv`, `~/.zprofile` 配置文件
- 智能识别 oh-my-zsh 安装路径
- 提取用户的插件列表和主题设置
- 保留所有自定义环境变量和别名

### oh-my-zsh 框架支持

- 完整支持 oh-my-zsh 框架
- 自动加载用户配置的主题 (如 robbyrussell)
- 支持所有标准和自定义插件
- 保持原有的提示符和颜色方案

### 插件生态系统

- **zsh-autosuggestions**: 智能命令建议
- **zsh-syntax-highlighting**: 语法高亮
- **git**: Git 集成和状态显示
- 所有其他 oh-my-zsh 插件都完全支持

## 🔧 技术实现

### ZshConfig 结构

```rust
pub struct ZshConfig {
    pub zdotdir: PathBuf,           // Zsh 配置目录
    pub zshrc_path: PathBuf,        // .zshrc 文件路径
    pub has_oh_my_zsh: bool,        // 是否安装 oh-my-zsh
    pub oh_my_zsh_path: Option<PathBuf>, // oh-my-zsh 安装路径
    pub plugins: Vec<String>,       // 检测到的插件列表
    pub theme: Option<String>,      // 当前主题
}
```

### 自动检测流程

1. 检查 `~/.zshrc` 文件是否存在
2. 解析配置文件提取关键信息：
   - `export ZSH=` 语句定位 oh-my-zsh
   - `plugins=(...)` 提取插件列表
   - `ZSH_THEME=` 获取主题设置
3. 设置适当的环境变量
4. 启动带完整配置的交互式 zsh

### 环境变量管理

- `SHELL`: 设置为正确的 zsh 路径
- `ZSH`: oh-my-zsh 安装目录
- `ZDOTDIR`: 用户的 zsh 配置目录
- `TERM`: xterm-256color (完整颜色支持)

## 🎯 用户体验

### 启动会话

```bash
# 自动使用你的 zsh 配置
riterm host --shell zsh --passthrough

# 会显示配置检测信息：
# 🐚 Zsh shell initialized in riterm session with user configuration
# 📦 oh-my-zsh detected with 3 plugins
# 🎨 Theme: robbyrussell
# 🔌 Plugins: git, zsh-autosuggestions, zsh-syntax-highlighting
```

### 完整功能支持

- ✅ 智能命令补全和建议
- ✅ 实时语法高亮
- ✅ Git 状态显示和快捷键
- ✅ 所有自定义别名和函数
- ✅ 用户的提示符主题
- ✅ 历史记录和搜索
- ✅ 目录跳转和路径补全

### 分享体验

当其他用户加入你的 riterm 会话时，他们会看到：

- 你的完整 zsh 环境
- 所有插件功能的实时效果
- 彩色高亮和智能提示
- 完整的终端交互体验

## 🔄 向后兼容

如果没有检测到用户配置，riterm 会回退到基本的 zsh 配置：

```bash
# 基本配置包括：
autoload -U colors && colors
export PS1='%{$fg[green]%}%n@%m%{$reset_color%}:%{$fg[blue]%}%~%{$reset_color%}$ '
echo '🐚 Zsh shell initialized in riterm session (basic configuration)'
```

## 📊 检测到的配置示例

基于你当前的 `~/.zshrc`：

- **Framework**: oh-my-zsh
- **Theme**: robbyrussell
- **Plugins**: git, zsh-autosuggestions, zsh-syntax-highlighting
- **Location**: `/Users/sternelee/.oh-my-zsh`

这意味着当你使用 riterm 分享终端时，所有参与者都能看到完全相同的 zsh 体验，包括：

- 智能的命令建议 (zsh-autosuggestions)
- 语法错误高亮 (zsh-syntax-highlighting)
- Git 仓库状态显示 (git plugin)
- robbyrussell 主题的提示符

## 🚀 开始使用

```bash
# 启动增强的 zsh 会话
riterm host --shell zsh --passthrough

# 其他人加入
riterm join <session-id> --peer <node-addr>

# 录制并回放
riterm host --shell zsh --passthrough --save zsh-session.json
riterm play zsh-session.json
```

现在你可以在 riterm 中享受完整的 zsh 体验，就像在本地终端中一样！🎉

