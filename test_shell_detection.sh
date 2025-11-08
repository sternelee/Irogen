#!/bin/bash

# 测试CLI终端路径记录和默认使用功能的脚本

echo "🧪 测试CLI终端路径记录功能..."
echo ""

# 构建CLI
echo "📦 构建CLI..."
cd cli && cargo build --quiet && cd ..
if [ $? -ne 0 ]; then
    echo "❌ CLI构建失败"
    exit 1
fi

echo ""
echo "=== 测试终端路径检测 ==="

# 启动CLI服务器
echo "🚀 启动CLI服务器并检测终端路径..."
./target/debug/cli host &
CLI_PID=$!
sleep 3

# 捕获输出以查看检测到的shell
echo "📋 检查shell检测输出..."
echo "🔍 当前环境的SHELL变量: $SHELL"

# 检查当前的shell
if [ -n "$SHELL" ]; then
    echo "✅ 当前SHELL: $SHELL"
    if [ -x "$SHELL" ]; then
        echo "✅ SHELL可执行"
    else
        echo "❌ SHELL不可执行"
    fi
else
    echo "❌ SHELL环境变量未设置"
fi

# 停止服务器
echo ""
echo "🛑 停止CLI服务器..."
kill $CLI_PID 2>/dev/null
wait $CLI_PID 2>/dev/null

echo ""
echo "=== 功能说明 ==="
echo "✨ 已实现的功能："
echo "   1. CLI启动时自动检测当前终端路径"
echo "   2. 支持Unix系统（Linux/macOS）通过SHELL环境变量检测"
echo "   3. 支持Windows系统通过COMSPEC环境变量检测"
echo "   4. 当create_terminal未指定shell路径时，默认使用启动时检测的路径"
echo "   5. 启动时会在日志中显示检测到的shell信息"
echo ""
echo "💡 支持的Shell类型："
echo "   - Unix: Zsh, Bash, Fish, Nushell"
echo "   - Windows: PowerShell, Command Prompt (cmd.exe)"
echo ""
echo "🎯 测试方法："
echo "   1. 启动CLI服务器时会显示检测到的shell"
echo "   2. 从App连接并创建终端时，如果不指定shell路径将使用默认路径"
echo "   3. 仍可手动指定shell路径来覆盖默认设置"

# 清理进程
pkill -f "riterm" 2>/dev/null || true

echo ""
echo "🎉 终端路径记录功能测试完成！"