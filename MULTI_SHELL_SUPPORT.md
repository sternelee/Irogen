# riterm - 全面的多Shell配置支持

riterm 现在支持自动检测和加载所有主流 shell 的用户配置，提供完整的终端体验！

## 🌟 支持的Shell及配置

### 1. 🐚 Zsh + oh-my-zsh
**检测文件**: `~/.zshrc`, `~/.zshenv`, `~/.zprofile`

**自动加载**:
- ✅ oh-my-zsh 框架检测
- ✅ 插件解析 (git, zsh-autosuggestions, zsh-syntax-highlighting)
- ✅ 主题配置 (robbyrussell)
- ✅ 环境变量设置 (ZSH, ZDOTDIR)

**用户体验**:
```bash
riterm host --shell zsh --passthrough
# 🐚 Zsh shell initialized in riterm session with user configuration
# 📦 oh-my-zsh detected with 3 plugins
# 🎨 Theme: robbyrussell
# 🔌 Plugins: git, zsh-autosuggestions, zsh-syntax-highlighting
```

### 2. 🐟 Fish Shell
**检测文件**: `~/.config/fish/config.fish`, `~/.config/fish/fish_variables`

**自动加载**:
- ✅ 配置文件检测
- ✅ 自定义函数目录 (`~/.config/fish/functions/`)
- ✅ 补全脚本目录 (`~/.config/fish/completions/`)
- ✅ 用户变量和环境设置
- ✅ conf.d 目录支持

**用户体验**:
```bash
riterm host --shell fish --passthrough
# 🐚 Fish shell initialized in riterm session with user configuration
# 📁 Custom functions directory found
# 🔄 Custom completions directory found
# 🔧 N user variables loaded
```

### 3. 🦀 Nushell
**检测文件**: `~/.config/nushell/config.nu`, `~/.config/nushell/env.nu`

**自动加载**:
- ✅ 主配置文件检测
- ✅ 环境配置文件支持
- ✅ 启动命令解析
- ✅ 结构化数据支持
- ✅ 现代shell特性

**用户体验**:
```bash
riterm host --shell nu --passthrough  
# 🐚 Nushell initialized in riterm session with user configuration
# 🌍 Environment configuration found
# 🚀 2 startup commands detected
```

### 4. ⚡ PowerShell
**检测文件**: 
- `~/.config/powershell/Microsoft.PowerShell_profile.ps1`
- `~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1`
- `~/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`

**自动加载**:
- ✅ 跨平台配置文件检测
- ✅ PowerShell 配置目录支持
- ✅ 模块和脚本加载
- ✅ 配置文件执行

**用户体验**:
```powershell
riterm host --shell pwsh --passthrough
# 🐚 PowerShell initialized in riterm session with user configuration
# 📋 PowerShell profile found
# 📁 Configuration directory found
```

## 🔧 技术架构

### 配置检测系统
每个shell都有专门的配置检测结构：

```rust
// Zsh配置
pub struct ZshConfig {
    pub zdotdir: PathBuf,
    pub zshrc_path: PathBuf,
    pub has_oh_my_zsh: bool,
    pub oh_my_zsh_path: Option<PathBuf>,
    pub plugins: Vec<String>,
    pub theme: Option<String>,
}

// Fish配置
pub struct FishConfig {
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub functions_dir: Option<PathBuf>,
    pub completions_dir: Option<PathBuf>,
    pub variables: HashMap<String, String>,
}

// Nushell配置
pub struct NushellConfig {
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub env_file: Option<PathBuf>,
    pub startup_commands: Vec<String>,
}

// PowerShell配置
pub struct PowerShellConfig {
    pub profile_path: Option<PathBuf>,
    pub config_dir: Option<PathBuf>,
    pub modules: Vec<String>,
}
```

### 环境变量管理
每个shell都会设置适当的环境变量：
- **通用**: `TERM=xterm-256color`, `SHELL=<shell_path>`
- **Zsh**: `ZDOTDIR`, `ZSH` (oh-my-zsh path)
- **Fish**: `FISH_CONFIG_DIR`
- **Nushell**: `NU_CONFIG_DIR`
- **PowerShell**: `POWERSHELL_PROFILE`

### 初始化命令
每个shell都有智能的初始化序列：
- 检测到用户配置时：显示详细的配置信息
- 未检测到配置时：回退到基本配置

## 🎯 使用方式

### 自动检测模式
```bash
# 使用当前默认shell及其配置
riterm host --passthrough

# 系统会自动：
# 1. 检测当前shell类型
# 2. 查找并解析配置文件
# 3. 设置适当的环境变量
# 4. 加载插件/模块/函数
# 5. 启动完整配置的shell
```

### 指定Shell模式
```bash
# 使用特定shell及其完整配置
riterm host --shell fish --passthrough
riterm host --shell nu --passthrough  
riterm host --shell zsh --passthrough
riterm host --shell pwsh --passthrough
```

### 配置检查
```bash
# 查看可用shell和配置状态
riterm host --list-shells
```

## 🌐 分享体验

### 主机端
当你启动一个配置完整的shell会话时：
- 所有插件和自定义功能都可用
- 保持你熟悉的提示符和主题
- 环境变量和别名正常工作
- 函数和补全功能完整

### 参与者端
其他用户加入你的会话时，他们会看到：
- 完全相同的shell环境
- 所有插件效果的实时显示
- 智能补全和语法高亮
- 自定义提示符和颜色方案

## 🔄 向后兼容

如果检测不到用户配置，riterm 会：
1. 显示相应的提示信息
2. 回退到该shell的基本配置
3. 确保基本功能正常工作
4. 提供最小化但可用的shell环境

## 📊 配置检测示例

基于你当前系统的配置检测结果：

### Zsh配置
- ✅ Framework: oh-my-zsh 
- ✅ Theme: robbyrussell
- ✅ Plugins: git, zsh-autosuggestions, zsh-syntax-highlighting
- ✅ Location: ~/.oh-my-zsh

### Fish配置  
- ✅ Config directory: ~/.config/fish/
- ✅ Custom completions: 3 files
- ✅ Functions: Available
- ✅ Variables: Loaded from fish_variables

### Nushell配置
- ✅ Config file: ~/.config/nushell/config.nu
- ✅ Environment file: ~/.config/nushell/env.nu  
- ✅ Startup commands: 2 detected

### PowerShell配置
- 🔍 Profile检测: 多个位置检查
- ⚡ 跨平台支持: Windows/macOS/Linux

## 🚀 开始使用

```bash
# 查看所有支持的shell
riterm host --list-shells

# 使用你喜欢的shell开始分享
riterm host --shell <your-shell> --passthrough

# 其他人加入体验完整的shell环境
riterm join <session-id> --peer <node-addr>

# 录制包含完整配置的会话
riterm host --shell zsh --passthrough --save my-zsh-session.json
```

现在 riterm 提供了真正的"原生"shell体验 - 每个shell都能以最佳状态运行，就像在本地终端中一样！🎉