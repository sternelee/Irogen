# iOS 打包和安装 - 快速参考

## 一键打包和安装

```bash
./scripts/ios-deploy.sh
```

## 分步执行

```bash
# 1. 构建前端
pnpm build

# 2. 编译 Rust 库
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build -p app --release --target aarch64-apple-ios

# 3. 准备库文件
mkdir -p app/gen/apple/Externals/arm64/release
cp target/aarch64-apple-ios/release/libirogen.a app/gen/apple/Externals/arm64/release/libapp.a

# 4. 生成 Xcode 项目
cd app/gen/apple && xcodegen generate && cd ../../..

# 5. 打包
pnpm tauri:ios:build

# 6. 安装到设备
ios-deploy -i <DEVICE_UDID> -b app/gen/apple/build/arm64/Irogen.ipa
```

## 获取设备 UDID

```bash
xcrun instruments -s devices | grep iPhone
```

## 常见问题速查表

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `ld: library 'app' not found` | 库未编译或未复制 | 检查 `app/gen/apple/Externals/arm64/release/libapp.a` 存在 |
| Swift 符号错误 | 部署目标版本不匹配 | `IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build ...` |
| 部署目标警告 | iOS 版本不匹配 | 这只是警告，不影响安装 |
| 设备未被识别 | USB 连接问题 | 拔掉重新插入，或信任开发者证书 |
| App 启动闪退 | 权限或特性不可用 | 查看日志：`ios-deploy -i <UDID> -W` |

## 环境检查

```bash
# 确保所有工具已安装
rustc --version
cargo --version
pnpm --version
xcodebuild -version
ios-deploy --version
xcodegen --version

# 确保 iOS 目标已安装
rustup target list | grep aarch64-apple-ios
```

## 查看完整文档

```bash
cat docs/iOS_BUILD_AND_INSTALL.md
```
