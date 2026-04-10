#!/bin/bash
set -e

# ============================================================================
# Irogen iOS 构建和安装脚本
# 用法: ./scripts/ios-deploy.sh [--device-udid <udid>] [--skip-install]
# ============================================================================

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
IPHONE_DEPLOYMENT_TARGET="15.0"
DEVICE_UDID=""
SKIP_INSTALL=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 函数定义
print_header() {
  echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --device-udid)
      DEVICE_UDID="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    *)
      print_error "未知参数: $1"
      exit 1
      ;;
  esac
done

# 检查前置条件
check_prerequisites() {
  print_header "检查前置条件"

  local missing=0

  # 检查 Rust
  if ! command -v rustc &> /dev/null; then
    print_error "未找到 Rust，请运行: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    missing=1
  else
    print_success "Rust 已安装"
  fi

  # 检查 Cargo
  if ! command -v cargo &> /dev/null; then
    print_error "未找到 cargo"
    missing=1
  else
    print_success "cargo 已安装"
  fi

  # 检查 pnpm
  if ! command -v pnpm &> /dev/null; then
    print_error "未找到 pnpm，请运行: npm install -g pnpm"
    missing=1
  else
    print_success "pnpm 已安装"
  fi

  # 检查 Xcode
  if ! command -v xcodebuild &> /dev/null; then
    print_error "未找到 Xcode，请安装 Xcode 15+"
    missing=1
  else
    print_success "Xcode 已安装"
  fi

  # 检查 xcodegen
  if ! command -v xcodegen &> /dev/null; then
    print_warning "未找到 xcodegen，正在安装..."
    brew install xcodegen
  else
    print_success "xcodegen 已安装"
  fi

  # 检查 ios-deploy
  if ! command -v ios-deploy &> /dev/null; then
    print_warning "未找到 ios-deploy，正在安装..."
    brew install ios-deploy
  else
    print_success "ios-deploy 已安装"
  fi

  # 检查 iOS 目标
  if ! rustup target list | grep -q "aarch64-apple-ios (installed)"; then
    print_warning "未安装 aarch64-apple-ios 目标，正在安装..."
    rustup target add aarch64-apple-ios
  else
    print_success "aarch64-apple-ios 目标已安装"
  fi

  if [ $missing -eq 1 ]; then
    print_error "缺少必要的工具"
    exit 1
  fi
}

# 构建前端
build_frontend() {
  print_header "步骤 1: 构建前端资源"
  
  cd "$PROJECT_ROOT"
  pnpm install
  pnpm build
  
  print_success "前端构建完成"
}

# 构建 Rust 库
build_rust() {
  print_header "步骤 2: 构建 Rust 库"
  
  cd "$PROJECT_ROOT"
  
  echo "编译 Release 版本..."
  IPHONEOS_DEPLOYMENT_TARGET="$IPHONE_DEPLOYMENT_TARGET" \
    cargo build -p app --release --target aarch64-apple-ios
  
  print_success "Rust 库构建完成"
}

# 准备库文件
prepare_libs() {
  print_header "步骤 3: 准备库文件"
  
  local externals_dir="$PROJECT_ROOT/app/gen/apple/Externals/arm64"
  
  # 创建目录
  mkdir -p "$externals_dir/release"
  mkdir -p "$externals_dir/debug"
  
  # 复制库文件
  echo "复制 Release 库..."
  if [ -f "$PROJECT_ROOT/target/aarch64-apple-ios/release/libirogen.a" ]; then
    cp "$PROJECT_ROOT/target/aarch64-apple-ios/release/libirogen.a" \
       "$externals_dir/release/libapp.a"
    print_success "Release 库已复制"
  else
    print_error "未找到编译的 Release 库"
    exit 1
  fi
  
  echo "复制 Debug 库..."
  if [ -f "$PROJECT_ROOT/target/aarch64-apple-ios/debug/libirogen.a" ]; then
    cp "$PROJECT_ROOT/target/aarch64-apple-ios/debug/libirogen.a" \
       "$externals_dir/debug/libapp.a"
    print_success "Debug 库已复制"
  else
    print_warning "未找到 Debug 库（可选）"
  fi
}

# 生成 Xcode 项目
generate_xcode() {
  print_header "步骤 4: 生成 Xcode 项目"
  
  cd "$PROJECT_ROOT/app/gen/apple"
  xcodegen generate
  print_success "Xcode 项目已生成"
}

# 打包应用
build_app() {
  print_header "步骤 5: 打包 iOS 应用"
  
  cd "$PROJECT_ROOT"
  pnpm tauri:ios:build
  
  if [ -f "$PROJECT_ROOT/app/gen/apple/build/arm64/Irogen.ipa" ]; then
    print_success "iOS 应用打包完成"
  else
    print_error "打包失败：未找到 .ipa 文件"
    exit 1
  fi
}

# 查找设备
find_device() {
  print_header "查找 iOS 设备"
  
  if [ -n "$DEVICE_UDID" ]; then
    echo "使用指定的设备: $DEVICE_UDID"
    return
  fi
  
  # 尝试从 xctrace 获取设备
  local devices=$(xcrun xctrace list devices 2>/dev/null | grep -oP '(?<=\()[\dA-F]{40}(?=\))')
  
  if [ -z "$devices" ]; then
    print_error "未找到连接的 iOS 设备"
    echo "请确保:"
    echo "1. iOS 设备已通过 USB 连接"
    echo "2. 在设备上信任了开发者证书"
    echo "3. 设置 > 通用 > VPN 与设备管理 中有开发者证书"
    exit 1
  fi
  
  # 使用第一个找到的设备
  DEVICE_UDID=$(echo "$devices" | head -1)
  print_success "找到设备: $DEVICE_UDID"
  
  # 显示设备信息
  local device_info=$(xcrun instruments -s devices 2>/dev/null | grep "$DEVICE_UDID" || echo "设备信息不可用")
  echo "  $device_info"
}

# 在设备上安装
install_app() {
  print_header "步骤 6: 在设备上安装应用"
  
  local ipa_path="$PROJECT_ROOT/app/gen/apple/build/arm64/Irogen.ipa"
  
  if [ ! -f "$ipa_path" ]; then
    print_error "未找到 .ipa 文件: $ipa_path"
    exit 1
  fi
  
  echo "安装到设备 $DEVICE_UDID..."
  ios-deploy -i "$DEVICE_UDID" -b "$ipa_path"
  
  print_success "应用安装完成"
}

# 显示总结
show_summary() {
  print_header "完成！"
  
  cat << EOF
${GREEN}✓ Irogen iOS 应用已成功构建和安装！${NC}

应用位置:
  .ipa 文件: $PROJECT_ROOT/app/gen/apple/build/arm64/Irogen.ipa

后续步骤:
  1. 在 iPhone 上找到 "Irogen" 应用
  2. 点击启动应用
  3. 如遇问题，运行: ios-deploy -i $DEVICE_UDID -W (查看日志)

故障排除:
  - 应用启动失败：检查 iPhone 上的权限设置
  - 设备未被识别：重启 USB 连接或设备
  - 其他问题：查看文档 docs/iOS_BUILD_AND_INSTALL.md

EOF
}

# 主函数
main() {
  echo -e "${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  Irogen iOS 构建和安装脚本          ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════╝${NC}"

  check_prerequisites
  build_frontend
  build_rust
  prepare_libs
  generate_xcode
  build_app

  if [ "$SKIP_INSTALL" = false ]; then
    find_device
    install_app
  fi

  show_summary
}

# 错误处理
trap 'print_error "执行过程中出错"; exit 1' ERR

# 运行主函数
main "$@"
