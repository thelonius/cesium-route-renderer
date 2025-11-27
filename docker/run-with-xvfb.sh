#!/bin/bash
set -e

LOG_FILE="/app/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Cesium canvas-based recording..." | tee -a "$LOG_FILE"
# Direct canvas extraction - no X server, no CDP screenshots
node record-canvas.js
