#!/bin/bash
set -e

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting CDP screenshot-based recording..." | tee -a "$LOG_FILE"
# No X server needed - headless Puppeteer with CDP screenshots
node record-cdp.js
