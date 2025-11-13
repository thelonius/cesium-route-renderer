#!/bin/bash

# Script to fix Docker networking issues on the remote server

SERVER="ubuntu@195.209.214.96"

echo "🔧 Attempting to fix Docker networking on remote server..."

ssh $SERVER << 'ENDSSH'
set -e

cd ~/cesium-route-renderer

echo "📊 Checking Docker status..."
docker info | grep -i "registry"

echo ""
echo "🌐 Testing Docker Hub connectivity..."
curl -I https://registry-1.docker.io/v2/ || echo "❌ Cannot reach Docker Hub"

echo ""
echo "🔄 Attempting to pull node:20 image..."

# Try different methods
echo "Method 1: Standard pull..."
if docker pull node:20; then
    echo "✅ Successfully pulled node:20"
    exit 0
fi

echo "Method 2: Pull with IPv4 only..."
if docker pull --platform linux/amd64 node:20; then
    echo "✅ Successfully pulled node:20 with platform flag"
    exit 0
fi

echo ""
echo "⚠️  All methods failed. Possible issues:"
echo "  1. IPv6 connectivity problem (server trying to use IPv6)"
echo "  2. Docker Hub rate limiting"
echo "  3. Network/firewall blocking Docker Hub"
echo ""
echo "Suggested fixes:"
echo "  1. Wait a few minutes and try again"
echo "  2. Contact server admin to check network/firewall"
echo "  3. Configure Docker to prefer IPv4"

ENDSSH

echo ""
echo "If the issue persists, you may need to:"
echo "  1. Check server network configuration"
echo "  2. Configure Docker daemon to use IPv4 only"
echo "  3. Use a Docker registry mirror"
