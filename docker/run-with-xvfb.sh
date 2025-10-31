#!/bin/bash
set -e

echo "Starting Xvfb with GLX support..."
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 2

echo "Running recording script..."
node record-puppeteer.js

# Cleanup
kill $XVFB_PID 2>/dev/null || true
