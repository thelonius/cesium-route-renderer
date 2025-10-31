#!/bin/bash

echo "=== Cesium Route Recorder Setup ==="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✓ Docker found"

# Build the Docker image
echo ""
echo "Building Docker image (this may take a few minutes)..."
docker build -t cesium-route-recorder . || {
    echo "❌ Docker build failed"
    exit 1
}

echo "✓ Docker image built successfully"

# Install server dependencies
echo ""
echo "Installing API server dependencies..."
cd server
npm install || {
    echo "❌ Failed to install server dependencies"
    exit 1
}
cd ..

echo "✓ Server dependencies installed"

# Test the setup
echo ""
echo "Testing the setup with default GPX file..."
docker run --rm \
  -v "$(pwd)/output:/output" \
  -e RECORD_DURATION=10 \
  cesium-route-recorder || {
    echo "❌ Test recording failed"
    exit 1
}

if [ -f "output/route-video.mp4" ]; then
    echo "✓ Test recording successful!"
    echo ""
    echo "Test video created: output/route-video.mp4"
    rm output/route-video.mp4
else
    echo "❌ Test video was not created"
    exit 1
fi

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "To start the API server:"
echo "  cd server && npm start"
echo ""
echo "To render a GPX file:"
echo "  node client-example.js path/to/your-route.gpx 60"
echo ""
echo "See DOCKER_SETUP.md for full documentation."
