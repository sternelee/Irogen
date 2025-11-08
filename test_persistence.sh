#!/bin/bash

# 测试持久化SecretKey功能的脚本

echo "🧪 测试RiTerm持久化SecretKey功能..."

# 测试CLI端
echo ""
echo "=== 测试CLI端持久化 ==="

# 清理之前的密钥文件
rm -f /tmp/test_secret_key

echo "📝 第一次启动CLI（应该生成新密钥）"
./target/debug/cli host --secret-key-file /tmp/test_secret_key &
CLI_PID=$!
sleep 3
kill $CLI_PID 2>/dev/null
wait $CLI_PID 2>/dev/null

if [ -f /tmp/test_secret_key ]; then
    echo "✅ 密钥文件已创建"
    ls -la /tmp/test_secret_key
else
    echo "❌ 密钥文件未创建"
    exit 1
fi

echo ""
echo "📝 第二次启动CLI（应该使用相同密钥）"
./target/debug/cli host --secret-key-file /tmp/test_secret_key &
CLI_PID2=$!
sleep 3
kill $CLI_PID2 2>/dev/null
wait $CLI_PID2 2>/dev/null

echo ""
echo "=== 测试完成 ==="
echo "💡 如果两次启动显示相同的Node ID，说明持久化功能正常工作"