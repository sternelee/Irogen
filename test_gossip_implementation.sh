#!/bin/bash

echo "Testing iroh-gossip implementation..."

# Start CLI in background and capture output
./target/debug/cli host --width 80 --height 24 > gossip_test_output.txt 2>&1 &
CLI_PID=$!

# Wait a bit for startup
sleep 5

# Kill the CLI process
kill $CLI_PID 2>/dev/null

# Check if the output contains expected gossip-related information
echo "Checking output for gossip functionality..."

if grep -q "Initializing iroh P2P network with gossip" gossip_test_output.txt; then
    echo "✅ Gossip network initialization found"
else
    echo "❌ Gossip network initialization not found"
fi

if grep -q "Session Ticket:" gossip_test_output.txt; then
    echo "✅ Session ticket generation found"
else
    echo "❌ Session ticket generation not found"
fi

if grep -q "Node ID:" gossip_test_output.txt; then
    echo "✅ Node ID display found"
else
    echo "❌ Node ID display not found"
fi

echo ""
echo "Sample output:"
head -20 gossip_test_output.txt

# Clean up
rm -f gossip_test_output.txt

echo ""
echo "Test completed."