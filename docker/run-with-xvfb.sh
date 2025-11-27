#!/bin/bash
set -e

# Ensure output directory exists (should be mounted as volume)
mkdir -p /output 2>/dev/null || true

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Cesium canvas-based recording..." | tee -a "$LOG_FILE"
# Direct canvas extraction - no X server, no CDP screenshots
node record-canvas.js
