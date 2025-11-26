#!/bin/bash

# Test Docker rendering with intro and outro enabled locally

echo "🎬 Testing intro/outro animations..."
echo "  Intro: 3 seconds (camera animation)"
echo "  Outro: 7 seconds (zoom out)"
echo ""

# Use alps-trail.gpx for quick testing
docker run --rm \
  -v "$(pwd)/public:/app/public:ro" \
  -v "$(pwd)/output:/app/output" \
  -e GPX_FILENAME=alps-trail.gpx \
  -e USER_NAME="Test User" \
  -e INTRO_TIME=3 \
  -e OUTRO_TIME=7 \
  -e TARGET_ROUTE_TIME=10 \
  cesium-route-recorder \
  sh run-with-xvfb.sh node record-canvas.js test-intro-outro

echo ""
echo "✅ Check output/test-intro-outro/ for frames and video"
echo "🎥 Video should show:"
echo "  1. Intro: Camera animating from top-down to tracking position (3s)"
echo "  2. Route: Animated route (~10s at calculated speed)"
echo "  3. Outro: Camera zooming out (7s)"
