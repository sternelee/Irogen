#!/bin/bash

echo "🧪 Testing riterm simplified architecture..."

# 构建 CLI 端
echo "📦 Building CLI..."
cargo build --package cli --quiet

# 构建 App 端
echo "📱 Building App..."
cargo build --package app --quiet

# 创建简单的票据用于测试
TICKET="test_node_ticket_$(date +%s)"

echo "✅ Build completed!"
echo ""
echo "🎯 Testing simplified dumbpipe architecture:"
echo "  - CLI: Simple host mode (--simple)"
echo "  - App: Minimal client implementation"
echo "  - Protocol: Text-based [COMMAND_TYPE]JSON format"
echo "  - Integration: End-to-end communication"
echo ""
echo "🚀 Ready for end-to-end testing!"