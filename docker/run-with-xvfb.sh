#!/bin/bash
set -e

# Ensure output directory exists (should be mounted as volume)
mkdir -p /output 2>/dev/null || true

LOG_FILE="/output/recorder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Starting Cesium canvas-based recording..." | tee -a "$LOG_FILE"

# Check if GPU mode is enabled
if [ "$USE_GPU" = "1" ] || [ "$USE_GPU" = "true" ]; then
    # Check if host X display is available (NVIDIA GPU rendering)
    if [ -n "$HOST_DISPLAY" ]; then
        echo "🖥️  GPU mode - using host X display $HOST_DISPLAY with NVIDIA GPU..." | tee -a "$LOG_FILE"
        export DISPLAY=$HOST_DISPLAY

        # Verify X server is accessible
        if ! xdpyinfo -display $HOST_DISPLAY >/dev/null 2>&1; then
            echo "⚠️  Host X display not accessible, falling back to Xvfb..." | tee -a "$LOG_FILE"
            HOST_DISPLAY=""
        else
            echo "✅ Connected to host X display $HOST_DISPLAY" | tee -a "$LOG_FILE"
        fi
    fi

    # Fallback to Xvfb if no host display
    if [ -z "$HOST_DISPLAY" ]; then
        echo "🖥️  GPU mode enabled - starting Xvfb virtual display..." | tee -a "$LOG_FILE"

        # Start Xvfb with GPU-friendly settings
        export DISPLAY=:99
        Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
        XVFB_PID=$!
        sleep 2

        # Verify Xvfb is running
        if ! kill -0 $XVFB_PID 2>/dev/null; then
            echo "❌ Xvfb failed to start" | tee -a "$LOG_FILE"
            exit 1
        fi
        echo "✅ Xvfb started on display :99 (PID: $XVFB_PID)" | tee -a "$LOG_FILE"
    fi
fi

# Run the recorder
node record-canvas.js

# Cleanup Xvfb if started
if [ -n "$XVFB_PID" ]; then
    kill $XVFB_PID 2>/dev/null || true
fi
