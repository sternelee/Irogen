#!/bin/bash

# Start the CLI server in the background and capture its output
cargo run --bin cli -- host --temp-key > cli_output.txt 2>&1 &
CLI_PID=$!

# Wait for the server to start and generate the ticket
sleep 3

# Kill the server
kill $CLI_PID 2>/dev/null || true
wait $CLI_PID 2>/dev/null || true

# Extract the ticket from the output
echo "=== CLI Output ==="
cat cli_output.txt

echo ""
echo "=== Looking for ticket ==="

# Look for the ticket line (it should appear after "🎫 Ticket:" or "🎫 Connection Ticket:")
grep -A 5 "🎫" cli_output.txt

echo ""
echo "=== Checking for 'ticket:' prefix ==="
# Check if any line contains "ticket:" prefix
if grep -q "ticket:" cli_output.txt; then
    echo "❌ Found 'ticket:' prefix in output:"
    grep "ticket:" cli_output.txt
    exit 1
else
    echo "✅ No 'ticket:' prefix found in output"
fi

# Clean up
rm -f cli_output.txt