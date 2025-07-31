#!/bin/bash

echo "Testing roterm with different shells..."

echo "1. Testing with Fish shell:"
echo "   cargo run -- host --shell fish --passthrough"
echo ""

echo "2. Testing with Zsh shell:"
echo "   cargo run -- host --shell zsh --passthrough"
echo ""

echo "3. Testing with Nushell:"
echo "   cargo run -- host --shell nu --passthrough"
echo ""

echo "4. Testing with Bash shell:"
echo "   cargo run -- host --shell bash --passthrough"
echo ""

echo "5. Testing automatic detection:"
echo "   cargo run -- host --passthrough"
echo ""

echo "All shells support:"
echo "- Interactive mode with proper prompts"
echo "- Environment variable setup"
echo "- Real-time terminal sharing via iroh P2P network"
echo "- Session recording and playback"
echo "- Custom shell initialization commands"

echo ""
echo "To test manually, run any of the above commands."
echo "The session will start in passthrough mode where you can type commands naturally."
echo "Other users can join using: roterm join <session-id> --peer <node-addr>"