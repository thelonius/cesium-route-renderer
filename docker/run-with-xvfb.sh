#!/bin/bash
set -e

# Ensure output directory exists (should be mounted as volume)
mkdir -p /output 2>/dev/null || true

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Cesium canvas-based recording..." | tee -a "$LOG_FILE"

# Start Xvfb virtual display for Chrome rendering
export DISPLAY=:99
Xvfb :99 -screen 0 1280x1024x24 -ac &
sleep 1

# Run the recorder
node record-canvas.js
