#!/bin/bash
set -e

# Ensure output directory exists
mkdir -p /app/output

LOG_FILE="/app/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Cesium recording..." | tee -a "$LOG_FILE"
node record-puppeteer.js
