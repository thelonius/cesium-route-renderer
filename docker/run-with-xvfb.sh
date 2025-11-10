#!/bin/bash
set -e

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Xvfb with GLX support and optimizations..." | tee -a "$LOG_FILE"
# Increase color depth to 24-bit and add performance flags
Xvfb :99 -screen 0 1080x1920x24 -ac +extension GLX +render -noreset -nolisten tcp -dpi 96 &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 2

# Set environment variables for better performance
export LIBGL_ALWAYS_SOFTWARE=0
export GALLIUM_DRIVER=llvmpipe

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Running FFmpeg-based recording script..." | tee -a "$LOG_FILE"
node record-ffmpeg.js

# Cleanup
kill $XVFB_PID 2>/dev/null || true
