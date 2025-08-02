#!/bin/bash

echo "Testing session ticket generation..."

# Start CLI in background and capture output
./target/debug/cli host --width 80 --height 24 > ticket_test_output.txt 2>&1 &
CLI_PID=$!

# Wait a bit for startup
sleep 5

# Kill the CLI process
kill $CLI_PID 2>/dev/null

# Check if the output contains session ticket
echo "Checking for session ticket..."

if grep -q "Session Ticket:" ticket_test_output.txt; then
    echo "✅ Session ticket found"
    echo "Ticket content:"
    grep "Session Ticket:" ticket_test_output.txt
else
    echo "❌ Session ticket not found"
fi

echo ""
echo "Full output:"
cat ticket_test_output.txt

# Clean up
rm -f ticket_test_output.txt

echo ""
echo "Test completed."