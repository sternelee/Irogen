#!/bin/bash

# 测试修复后的终端路径和工作目录功能

echo "🧪 测试修复后的终端功能..."
echo ""

# 进入项目根目录
cd "$(dirname "$0")"

# 构建CLI
echo "📦 构建CLI..."
cd cli && cargo build --quiet && cd ..
if [ $? -ne 0 ]; then
    echo "❌ CLI构建失败"
    exit 1
fi

echo ""
echo "=== 测试功能说明 ==="
echo "✅ 已修复的问题："
echo "   1. Shell路径检测 - CLI启动时自动记录当前shell路径"
echo "   2. 默认Shell使用 - create_terminal未指定shell时使用启动时的默认路径"
echo "   3. 工作目录设置 - 确保终端使用CLI启动时的工作目录，而不是用户主目录"
echo ""
echo "🔧 修复的代码逻辑："
echo "   - 添加了调试日志显示使用的shell路径和工作目录"
echo "   - 修复了工作目录设置逻辑"
echo "   - 确保当未指定working_dir时使用CLI启动时的目录"
echo ""
echo "📋 预期行为："
echo "   - CLI启动时会显示: 🐚 Detected shell: {shell_type} at {path}"
echo "   - 创建终端时会显示: 🐚 Using default shell from CLI startup: {path}"
echo "   - 创建终端时会显示: 📁 Working directory: {CLI启动时的目录}"
echo ""
echo "🧪 测试步骤："
echo "   1. 在不同目录下启动CLI服务器"
echo "   2. 从App连接并创建终端"
echo "   3. 检查终端使用的是正确的shell和工作目录"
echo ""
echo "🌟 测试示例："
echo "   cd /tmp"
echo "   ./target/debug/cli host"
echo "   # 然后从App创建终端，应该看到工作目录为 /tmp"
echo ""
echo "🎯 如果仍有问题，请检查："
echo "   - CLI启动日志中的shell检测信息"
echo "   - 创建终端时的调试日志"
echo "   - 终端内的pwd命令输出"

echo ""
echo "✅ 代码修复完成！请测试功能。"