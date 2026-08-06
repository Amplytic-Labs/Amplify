#!/bin/bash
# Start the Open_Claude (Amplify) dev server and keep it alive
# Uses Vite with Remix on port 5173

PORT=5173
LOG_FILE="/tmp/open-claude-dev.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "★ Starting Amplify dev server on port $PORT..."
echo "★ Log file: $LOG_FILE"

cd "$SCRIPT_DIR"

# Kill any existing instance on this port
pkill -f "remix vite:dev" 2>/dev/null
sleep 1

# Start the dev server with host 0.0.0.0 so it's accessible
# nohup keeps it running after the script exits
nohup pnpm run dev > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo "★ Server PID: $SERVER_PID"
echo "★ Waiting for server to be ready..."

# Wait up to 60 seconds for the server to start
for i in $(seq 1 60); do
  if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "★ Server is listening on port $PORT!"
    echo "★ Access at: http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done

echo "✗ Server failed to start within 60 seconds. Check log: $LOG_FILE"
echo "--- Last 20 lines of log ---"
tail -20 "$LOG_FILE"
exit 1
