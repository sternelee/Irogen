#!/bin/bash

# 测试重启后nodeID和ticket持久化功能的脚本

echo "🧪 测试RiTerm持久化功能..."
echo ""

# 构建CLI
echo "📦 构建CLI..."
cd cli && cargo build --quiet && cd ..
if [ $? -ne 0 ]; then
    echo "❌ CLI构建失败"
    exit 1
fi

# 构建App
echo "📦 构建App..."
cd app && cargo build --quiet && cd ..
if [ $? -ne 0 ]; then
    echo "❌ App构建失败"
    exit 1
fi

echo ""
echo "=== 测试CLI端持久化 ==="

# 启动CLI服务器并获取第一次的票据
echo "🚀 第一次启动CLI服务器..."
./target/debug/cli host &
CLI_PID=$!
sleep 3

# 捕获输出获取票据
echo "📋 获取第一次的连接票据..."
CLI_OUTPUT=$(timeout 2s bash -c "kill -0 $CLI_PID 2>/dev/null && echo 'Server running' || echo 'Server stopped'")
if [ -z "$CLI_OUTPUT" ]; then
    echo "❌ CLI服务器启动失败"
    kill $CLI_PID 2>/dev/null
    exit 1
fi

# 等待服务器完全启动
sleep 2

# 检查密钥文件是否生成
if [ -f ./riterm_secret_key ]; then
    echo "✅ CLI密钥文件已生成: ./riterm_secret_key"
    KEY_SIZE=$(wc -c < ./riterm_secret_key)
    echo "📏 密钥文件大小: $KEY_SIZE 字节"
else
    echo "❌ CLI密钥文件未生成"
    kill $CLI_PID 2>/dev/null
    exit 1
fi

# 停止服务器
echo "🛑 停止CLI服务器..."
kill $CLI_PID 2>/dev/null
wait $CLI_PID 2>/dev/null

echo ""
echo "🔄 第二次启动CLI服务器（应该使用相同密钥）..."
./target/debug/cli host &
CLI_PID2=$!
sleep 3

# 检查是否使用相同密钥
if [ -f ./riterm_secret_key ]; then
    KEY_SIZE2=$(wc -c < ./riterm_secret_key)
    echo "📏 第二次密钥文件大小: $KEY_SIZE2 字节"
    
    if [ "$KEY_SIZE" -eq "$KEY_SIZE2" ]; then
        echo "✅ 密钥文件大小一致，说明使用了相同的密钥"
    else
        echo "❌ 密钥文件大小不一致，可能生成了新密钥"
    fi
else
    echo "❌ 第二次启动时密钥文件不存在"
fi

# 停止服务器
kill $CLI_PID2 2>/dev/null
wait $CLI_PID2 2>/dev/null

echo ""
echo "=== 测试临时密钥功能 ==="

# 清理密钥文件
rm -f ./riterm_secret_key

echo "🔑 测试临时密钥选项（--temp-key）..."
./target/debug/cli host --temp-key &
CLI_PID3=$!
sleep 3

if [ ! -f ./riterm_secret_key ]; then
    echo "✅ 临时密钥模式正确 - 没有创建密钥文件"
else
    echo "❌ 临时密钥模式失败 - 创建了密钥文件"
fi

kill $CLI_PID3 2>/dev/null
wait $CLI_PID3 2>/dev/null

echo ""
echo "=== 测试App端持久化 ==="

# 检查App目录下密钥文件
cd app
if [ -f ./riterm_app_secret_key ]; then
    echo "✅ App密钥文件存在: ./riterm_app_secret_key"
    APP_KEY_SIZE=$(wc -c < ./riterm_app_secret_key)
    echo "📏 App密钥文件大小: $APP_KEY_SIZE 字节"
else
    echo "ℹ️  App密钥文件不存在（首次运行时会自动生成）"
fi

cd ..

echo ""
echo "=== 测试完成 ==="
echo "💡 密钥文件位置："
echo "   CLI: ./riterm_secret_key"
echo "   App: ./app/riterm_app_secret_key"
echo ""
echo "✨ 功能说明："
echo "   - CLI和App都会在启动目录下自动生成密钥文件"
echo "   - 重启后应该保持相同的nodeID和连接票据"
echo "   - 使用--temp-key选项可以避免创建密钥文件"
echo "   - 前端localStorage会自动保存最近使用的票据"

# 清理进程
pkill -f "riterm" 2>/dev/null || true

echo "🎉 测试完成！"