#!/bin/bash
set -e

echo "Starting Xvfb with GLX support and optimizations..."
# Increase color depth to 24-bit and add performance flags
Xvfb :99 -screen 0 1080x1920x24 -ac +extension GLX +render -noreset -nolisten tcp -dpi 96 &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 2

# Set environment variables for better performance
export LIBGL_ALWAYS_SOFTWARE=0
export GALLIUM_DRIVER=llvmpipe

echo "Running recording script..."
node record-canvas.js

# Cleanup
kill $XVFB_PID 2>/dev/null || true
