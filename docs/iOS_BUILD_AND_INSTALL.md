# Irogen iOS 打包和安装流程指导

本文档记录了 Irogen 项目 iOS 版本的完整打包和安装流程，包括常见问题和解决方案。

## 前置条件

- macOS 系统
- Xcode 15+ 已安装
- iOS 设备（iPhone/iPad）通过 USB 连接
- 开发者证书配置完成
- 已安装依赖工具：
  - Rust 稳定版（`rustup install stable`）
  - Node.js 20+
  - pnpm 10+
  - `ios-deploy`：`brew install ios-deploy`
  - `xcodegen`：`brew install xcodegen`

## 快速开始

### 1. 构建并安装（一键完成）

```bash
cd /path/to/Irogen

# 方法A：使用预定义脚本（推荐）
./scripts/ios-deploy.sh

# 方法B：手动执行（见下文详细步骤）
```

### 2. 验证设备连接

```bash
xcrun xctrace list devices
# 查看输出中是否有你的设备
# 示例：Sterne的iPhone se (26.4) (00008030-000A21391A83802E)
```

## 详细步骤

### 步骤1：构建前端资源

```bash
pnpm install
pnpm build
```

**输出示例：**
```
dist/index.html                   0.55 kB │ gzip:   0.33 kB
dist/assets/index-DrZnLPQs.css  357.36 kB │ gzip:  54.85 kB
dist/assets/index-BGmARW2N.js   552.47 kB │ gzip: 168.57 kB
✓ built in 5.39s
```

### 步骤2：构建 Rust 库（Release 版本）

```bash
# 针对 iOS arm64 架构构建
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build -p app --release --target aarch64-apple-ios
```

**构建输出：**
- `target/aarch64-apple-ios/release/libirogen.a` (188.2M)
- `target/aarch64-apple-ios/release/libirogen.dylib` (17.3M)

**重要：** 设置 `IPHONEOS_DEPLOYMENT_TARGET=15.0` 确保库的最小部署目标与 Xcode 项目匹配（见 `app/gen/apple/project.yml`）。

### 步骤3：准备 Xcode 项目

生成 Xcode 项目（使用 xcodegen）：

```bash
cd app/gen/apple
xcodegen generate
cd /path/to/Irogen
```

**输出：**
```
⚙️  Generating plists...
⚙️  Generating project...
⚙️  Writing project...
Created project at /Users/sternelee/www/github/Irogen/app/gen/apple/app.xcodeproj
```

### 步骤4：复制编译的库到 Xcode 项目

关键步骤：Xcode 项目期望在特定位置找到 Rust 静态库。

```bash
# 创建目录结构
mkdir -p app/gen/apple/Externals/arm64/release
mkdir -p app/gen/apple/Externals/arm64/debug

# 复制 Release 库
cp target/aarch64-apple-ios/release/libirogen.a \
   app/gen/apple/Externals/arm64/release/libapp.a

# 复制 Debug 库（用于开发）
cp target/aarch64-apple-ios/debug/libirogen.a \
   app/gen/apple/Externals/arm64/debug/libapp.a
```

**注意：** 库的名称必须是 `libapp.a`，因为 `project.yml` 中依赖声明是：
```yaml
- framework: $(SRCROOT)/Externals/arm64/$(CONFIGURATION)/libapp.a
```

### 步骤5：使用 Tauri CLI 打包

```bash
pnpm tauri:ios:build
```

**流程：**
1. 触发 `beforeBuildCommand`：`pnpm build`（再次构建前端）
2. 调用 xcodebuild，编译 iOS app
3. 导出 .ipa 文件

**成功输出：**
```
Exported app_iOS to: /Users/sternelee/www/github/Irogen/app/gen/apple/build
    Finished 1 iOS Bundle at:
        /Users/sternelee/www/github/Irogen/app/gen/apple/build/arm64/Irogen.ipa
```

**输出路径：** `app/gen/apple/build/arm64/Irogen.ipa`

### 步骤6：在设备上安装应用

获取设备 UDID：

```bash
# 方法 1：从 xctrace 获取
xcrun xctrace list devices | grep "iPhone"
# 输出：Sterne的iPhone se (26.4) (00008030-000A21391A83802E)

# 方法 2：从 Xcode 设备列表获取
xcrun instruments -s devices
```

使用 ios-deploy 安装：

```bash
ios-deploy -i <DEVICE_UDID> -b app/gen/apple/build/arm64/Irogen.ipa
```

**示例：**
```bash
ios-deploy -i 00008030-000A21391A83802E -b \
  app/gen/apple/build/arm64/Irogen.ipa
```

**安装进度示例：**
```
[....] Using 00008030-000A21391A83802E (iPhone SE 2G, iphoneos, arm64e, 26.4)
[  5%] Copying files...
[ 50%] Installing Application
[100%] InstallComplete
[100%] Installed package /path/to/Irogen.ipa
```

## 常见问题和解决方案

### 问题1：找不到 Rust 库 `libapp.a`

**错误信息：**
```
ld: library 'app' not found
clang++: error: linker command failed with exit code 1
```

**原因：** 
- 库未编译或未复制到正确位置
- 库位置不符合 Xcode 项目的期望路径

**解决方案：**
```bash
# 1. 验证库已编译
ls -lh target/aarch64-apple-ios/release/libirogen.a

# 2. 验证库已复制到正确位置
ls -lh app/gen/apple/Externals/arm64/release/libapp.a

# 3. 检查 project.yml 中的依赖声明
grep -A 2 "libapp.a" app/gen/apple/project.yml

# 4. 重新生成 Xcode 项目
cd app/gen/apple && xcodegen generate && cd ../../../
```

### 问题2：Swift 符号链接错误

**错误信息：**
```
Undefined symbols for architecture arm64:
  "__swift_FORCE_LOAD_$_swiftCompatibility51", referenced from:
      __swift_FORCE_LOAD_$_swiftCompatibility51_$_SwiftRs in libapp.a
ld: symbol(s) not found for architecture arm64
```

**原因：**
- Rust 库编译时使用的 iOS 部署目标高于 Xcode 项目配置的目标
- Swift 兼容性库链接不完整

**解决方案：**
```bash
# 1. 重新编译 Rust 库，设置匹配的部署目标
IPHONEOS_DEPLOYMENT_TARGET=15.0 \
  cargo build -p app --release --target aarch64-apple-ios

# 2. 更新库
cp target/aarch64-apple-ios/release/libirogen.a \
   app/gen/apple/Externals/arm64/release/libapp.a

# 3. 重新生成 Xcode 项目
cd app/gen/apple && xcodegen generate && cd ../../../

# 4. 重新打包
pnpm tauri:ios:build
```

**关键：** 确保 `IPHONEOS_DEPLOYMENT_TARGET` 与 `app/gen/apple/project.yml` 中的 `deploymentTarget.iOS` 一致：

```yaml
options:
  deploymentTarget:
    iOS: "15.0"  # 必须匹配
```

### 问题3：部署目标版本警告

**警告信息：**
```
ld: warning: object file (...) was built for newer 'iOS' version (26.4) than being linked (15.0)
```

**原因：** 库编译时使用的 iOS SDK 版本高于项目的部署目标（这是正常的）

**解决方案：** 这只是警告，不影响安装。如需消除：

```bash
# 在编译时明确指定部署目标
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build -p app --release --target aarch64-apple-ios
```

### 问题4：安装时"App Unexpectedly Quit"

**原因：** 
- 权限配置不完整
- 某些特性在 iOS 上不可用

**解决方案：**
```bash
# 1. 检查 app/gen/apple/app_iOS/app_iOS.entitlements
cat app/gen/apple/app_iOS/app_iOS.entitlements

# 2. 查看设备日志
ios-deploy -i <UDID> -W  # 输出日志信息

# 3. 在 Xcode 中运行以获取完整日志
open app/gen/apple/app.xcodeproj
# 然后选择 Product > Run
```

### 问题5：设备不被识别

**错误：**
```
[....] Waiting for iOS device to be connected
```

**解决方案：**
```bash
# 1. 验证设备连接
xcrun instruments -s devices

# 2. 信任开发者
# 在 iPhone 上：设置 > 通用 > VPN 与设备管理 > 信任开发者证书

# 3. 重启 USB 连接或设备
# 拔掉并重新插入 USB 线
# 或重启 iPhone

# 4. 重启 Xcode 服务
killall -9 usbmuxd
killall -9 Xcode
# 然后重新尝试
```

## 开发工作流

### 快速迭代开发

对于快速迭代，使用 Tauri 开发模式而不是打包：

```bash
# 在 macOS 上运行桌面开发版本
pnpm tauri:dev

# 或构建 iOS debug 版本并在模拟器上测试
pnpm tauri:ios:dev
```

### 完整打包流程（生产构建）

```bash
#!/bin/bash
set -e

echo "=== Step 1: 构建前端 ==="
pnpm build

echo "=== Step 2: 构建 Rust 库 ==="
IPHONEOS_DEPLOYMENT_TARGET=15.0 \
  cargo build -p app --release --target aarch64-apple-ios

echo "=== Step 3: 准备 Externals 目录 ==="
mkdir -p app/gen/apple/Externals/arm64/release
cp target/aarch64-apple-ios/release/libirogen.a \
   app/gen/apple/Externals/arm64/release/libapp.a

echo "=== Step 4: 生成 Xcode 项目 ==="
cd app/gen/apple && xcodegen generate && cd ../../..

echo "=== Step 5: 打包 iOS 应用 ==="
pnpm tauri:ios:build

echo "=== Step 6: 安装到设备 ==="
DEVICE_UDID=$(xcrun instruments -s devices 2>/dev/null | grep -oP '(?<=\()[\dA-F]{40}(?=\))' | head -1)
if [ -z "$DEVICE_UDID" ]; then
  echo "错误：未找到连接的 iOS 设备"
  exit 1
fi

ios-deploy -i "$DEVICE_UDID" -b "app/gen/apple/build/arm64/Irogen.ipa"

echo "✅ 完成！应用已安装到设备。"
```

## 环境变量参考

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` | iOS 最小部署目标版本 |
| `CARGO_BUILD_TARGET` | `aarch64-apple-ios` | 编译目标架构 |
| `RUST_LOG` | `info` | Rust 日志级别 |
| `RUST_BACKTRACE` | `full` | Rust 错误跟踪详级别 |

## 文件位置参考

| 文件/目录 | 用途 |
|-----------|------|
| `app/Cargo.toml` | Rust 库配置 |
| `app/gen/apple/project.yml` | Xcode 项目配置（xcodegen）|
| `app/gen/apple/app.xcodeproj/` | 生成的 Xcode 项目 |
| `app/gen/apple/Externals/arm64/` | 编译库的存放位置 |
| `app/gen/apple/build/arm64/Irogen.ipa` | 最终的 iOS 应用包 |
| `target/aarch64-apple-ios/release/libirogen.a` | 编译的 Rust 静态库 |

## 版本要求

| 工具 | 最低版本 | 备注 |
|------|---------|------|
| Xcode | 15.0 | 必需 Swift 5.0+ |
| iOS SDK | 15.0 | 部署目标 |
| Rust | 1.70+ | stable channel |
| Node.js | 20+ | 前端构建 |
| pnpm | 10+ | 包管理 |

## 发布检查清单

在将应用发布到 App Store 之前：

- [ ] 更新 `app/tauri.conf.json` 中的版本号
- [ ] 检查 `app/gen/apple/app_iOS/Info.plist` 中的 `CFBundleVersion`
- [ ] 验证所有权限已在 `app_iOS.entitlements` 中声明
- [ ] 运行 `cargo clippy --workspace -- -D warnings`
- [ ] 运行 `pnpm lint` 和 `pnpm format`
- [ ] 执行完整的功能测试
- [ ] 验证日志记录不会暴露敏感信息
- [ ] 使用 Release 构建（不是 Debug）
- [ ] 检查应用签名证书有效期

## 参考资源

- [Tauri iOS 官方文档](https://tauri.app/v1/guides/getting-started/setup/mobile)
- [xcodegen 文档](https://github.com/yonaskolb/XcodeGen)
- [iOS 开发配置指南](https://developer.apple.com/documentation/xcode)
- [Rust iOS 支持](https://rust-lang.github.io/rustup/cross-compilation.html)

## 故障排除命令

```bash
# 清理构建缓存
cargo clean
rm -rf app/gen/apple/build

# 验证 Rust 工具链
rustup show

# 检查 iOS 目标是否已安装
rustup target list | grep aarch64-apple-ios

# 安装缺失的 iOS 目标
rustup target add aarch64-apple-ios

# 显示所有连接的设备
xcrun instruments -s devices

# 获取设备详细信息
ios-deploy -c

# 查看实时日志
ios-deploy -i <UDID> -W
```

## 更新历史

| 日期 | 版本 | 更改 |
|------|------|------|
| 2026-04-10 | 1.0 | 初始文档，包含完整打包流程和常见问题解决 |
