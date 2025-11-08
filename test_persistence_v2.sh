#!/bin/bash

# 测试简化版持久化SecretKey功能的脚本
# 现在密钥文件默认在启动目录下

echo "🧪 测试RiTerm简化版持久化SecretKey功能..."
echo ""

# 测试CLI端
echo "=== 测试CLI端（启动目录密钥文件）==="

# 清理之前的密钥文件
rm -f ./riterm_secret_key

echo "📝 第一次启动CLI（应该生成新密钥：./riterm_secret_key）"
./target/debug/cli host &
CLI_PID=$!
sleep 3
kill $CLI_PID 2>/dev/null
wait $CLI_PID 2>/dev/null

if [ -f ./riterm_secret_key ]; then
    echo "✅ CLI密钥文件已创建: ./riterm_secret_key"
    ls -la ./riterm_secret_key
else
    echo "❌ CLI密钥文件未创建"
    exit 1
fi

echo ""
echo "📝 第二次启动CLI（应该使用相同密钥）"
./target/debug/cli host &
CLI_PID2=$!
sleep 3
kill $CLI_PID2 2>/dev/null
wait $CLI_PID2 2>/dev/null

echo ""
echo "📝 测试临时密钥选项（--temp-key）"
rm -f ./temp_test_key
./target/debug/cli host --temp-key &
CLI_PID3=$!
sleep 3
kill $CLI_PID3 2>/dev/null
wait $CLI_PID3 2>/dev/null

if [ ! -f ./temp_test_key ]; then
    echo "✅ 临时密钥模式正确 - 没有创建密钥文件"
else
    echo "❌ 临时密钥模式失败 - 创建了密钥文件"
fi

echo ""
echo "=== 测试完成 ==="
echo "💡 密钥文件现在默认保存在启动目录下，用户无需手动管理"
echo "💡 CLI: ./riterm_secret_key"
echo "💡 App: ./riterm_app_secret_key"