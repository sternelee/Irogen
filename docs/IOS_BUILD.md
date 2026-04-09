# iOS 构建与安装指南

## 环境要求

- macOS
- Xcode 15+
- Rust stable
- Node.js 20+
- pnpm 10+
- 已连接的 iOS 设备

## 准备工作

### 1. 安装 Rust iOS 目标

```bash
rustup target add aarch64-apple-ios
rustup target add aarch64-apple-ios-sim
```

### 2. 配置 Bundle Identifier

修改 `app/tauri.conf.json`，确保 `identifier` 是唯一的（建议包含开发者标识）：

```json
{
  "identifier": "com.irogen.dev.sterne"
}
```

### 3. 配置开发团队

在 `app/tauri.conf.json` 中设置 `bundle.iOS.developmentTeam`：

```json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "你的团队ID"
    }
  }
}
```

或在 Xcode 中手动配置签名。

## 构建流程

### 方式一：使用 Tauri CLI（推荐）

```bash
cd Irogen

# 1. 构建 iOS 版本
pnpm tauri build --target aarch64-apple-ios

# 2. 初始化 Xcode 项目（如果需要）
pnpm tauri ios init

# 3. 构建并打包 IPA
pnpm tauri ios build
```

### 方式二：手动 Xcode 构建

```bash
# 1. 生成 Xcode 项目
pnpm tauri ios init

# 2. 打开项目
open app/gen/apple/app.xcodeproj

# 3. 在 Xcode 中配置签名并运行
```

## 项目配置说明

### 修改 app/gen/apple/project.yml

关键配置：

```yaml
name: app
options:
  bundleIdPrefix: com.irogen.dev.sterne
  deploymentTarget:
    iOS: "15.0"

targets:
  app_iOS:
    type: application
    platform: iOS
    sources:
      - path: Sources
      - path: Assets.xcassets
      - path: app_iOS
      - path: assets
        buildPhase: resources
        type: folder
      - path: LaunchScreen.storyboard
    settings:
      base:
        ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: true
        SWIFT_VERSION: 5.0
    dependencies:
      - sdk: CoreGraphics.framework
      - sdk: Metal.framework
      - sdk: MetalKit.framework
      - sdk: QuartzCore.framework
      - sdk: Security.framework
      - sdk: UIKit.framework
      - sdk: WebKit.framework
```

## 安装到设备

### 使用 devicectl 安装 IPA

```bash
# 1. 构建成功后，IPA 位于
# app/gen/apple/build/arm64/Irogen.ipa

# 2. 安装到已连接设备
xcrun devicectl device install app --device "设备名称" \
  app/gen/apple/build/arm64/Irogen.ipa
```

### 使用 Xcode 安装

1. 打开 `app/gen/apple/app.xcodeproj`
2. 选择目标设备
3. 点击 Run (⌘R)

## 启动应用

### 命令行启动

```bash
xcrun devicectl device process launch --device "设备名称" com.irogen.dev.sterne
```

### 手动启动

在 iPhone 主屏幕点击应用图标。

## 首次运行配置

首次安装后需要在 iPhone 上信任开发者：

1. 打开 **设置** → **通用**
2. 找到 **VPN与设备管理**（或 **描述文件与设备管理**）
3. 点击 **开发者APP** 下的你的账号
4. 点击 **信任**

## 常见问题

### Bundle Identifier 已被注册

```
error: Failed Registering Bundle Identifier: The app identifier "com.irogen.dev" cannot be registered
```

**解决方案**：修改 `identifier` 为唯一值，如 `com.irogen.dev.你的名字`

### Swift 兼容性库错误

```
Could not find or use auto-linked library 'swiftCompatibility56'
Undefined symbol: __swift_FORCE_LOAD_$_swiftCompatibility56
```

**解决方案**：在 `project.yml` 中设置 `ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: true`

### Xcode 数据库锁定

```
unable to access build database: database is locked
```

**解决方案**：

```bash
# 终止所有 xcodebuild 进程
pkill -f xcodebuild

# 清理 DerivedData
rm -rf ~/Library/Developer/Xcode/DerivedData
```

### Build Rust Code 脚本失败

Tauri iOS 构建会尝试运行 `pnpm tauri ios xcode-script`，这需要 Tauri CLI 正常运行。

**解决方案**：确保在项目根目录运行命令，或使用方式二手动 Xcode 构建。

## IPA 输出位置

```
app/gen/apple/build/arm64/Irogen.ipa
```

## 开发者

- 团队 ID: HUJ467VC3N (Sterne Lee)
- Bundle ID: com.irogen.dev.sterne
