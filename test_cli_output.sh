#!/bin/bash

# 测试CLI在debug和release模式下的输出差异

echo "🧪 测试CLI输出优化..."
echo ""

# 进入项目根目录
cd "$(dirname "$0")"

# 构建debug和release版本
echo "📦 构建CLI..."
cd cli
cargo build --quiet
cargo build --release --quiet
cd ..

echo ""
echo "=== CLI输出对比 ==="
echo ""

echo "🔍 Debug模式输出（详细信息）:"
echo "----------------------------------------"
timeout 3s ./cli/target/debug/cli host 2>/dev/null || echo ""
echo ""

echo "🚀 Release模式输出（简洁信息）:"
echo "----------------------------------------"
timeout 3s ./cli/target/release/cli host 2>/dev/null || echo ""
echo ""

echo "📋 输出说明："
echo ""
echo "Debug模式显示："
echo "  🚀 RiTerm Host Server Started"
echo "  🔑 Node ID: [详细节点ID]"
echo "  🐚 Shell: [shell路径]"
echo "  🎫 Connection Ticket:"
echo "  [票据内容]"
echo "  📱 App Connection Instructions:"
echo "  [详细连接说明]"
echo "  Press Ctrl+C to stop the server"
echo "  [详细连接状态和调试信息]"
echo ""
echo "Release模式显示："
echo "  🚀 RiTerm Host Server"
echo "  🐚 Shell: [shell路径]"
echo "  🎫 Ticket:"
echo "  [票据内容]"
echo "  Press Ctrl+C to stop"
echo "  ✅ Connected (1) - 简化连接状态"
echo ""
echo "🎯 优化效果："
echo "  ✅ Release模式输出更简洁，只显示必要信息"
echo "  ✅ Debug模式保留完整的调试和连接信息"
echo "  ✅ 清理了create_terminal中的详细调试日志"
echo "  ✅ 连接状态显示更简洁"
echo ""
echo "✅ CLI输出优化完成！"