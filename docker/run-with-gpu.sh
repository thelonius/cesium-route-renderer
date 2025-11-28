#!/bin/bash
set -e

# GPU-enabled startup script
# Uses Xvfb with GPU acceleration via VirtualGL or direct rendering

# Ensure output directory exists
mkdir -p /output 2>/dev/null || true

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting GPU-accelerated Cesium recording..." | tee -a "$LOG_FILE"

# Check for NVIDIA GPU
if command -v nvidia-smi &> /dev/null; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] GPU detected:" | tee -a "$LOG_FILE"
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | tee -a "$LOG_FILE"
    export USE_GPU=1
else
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] ⚠️ No GPU detected, falling back to software rendering" | tee -a "$LOG_FILE"
    export USE_GPU=0
fi

# Start Xvfb with GPU-compatible settings
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Xvfb started on display :99" | tee -a "$LOG_FILE"

# Run the recording
node record-canvas.js

# Cleanup
kill $XVFB_PID 2>/dev/null || true
