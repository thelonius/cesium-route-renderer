#!/bin/bash

# Deployment script for GPX Route Video Renderer
# Server: 195.133.27.96
# User: kykyryzik

SERVER="195.133.27.96"
USER="kykyryzik"
DEPLOY_DIR="/home/kykyryzik/cesium-route-renderer"

echo "🚀 Deploying to $SERVER..."

# Create deploy directory on server
ssh ${USER}@${SERVER} "mkdir -p ${DEPLOY_DIR}"

# Copy project files (excluding node_modules, output, etc.)
echo "📦 Copying project files..."
rsync -avz --exclude 'node_modules' \
  --exclude 'output' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'temp' \
  --exclude 'public/cesium' \
  ./ ${USER}@${SERVER}:${DEPLOY_DIR}/

# Run setup on server
echo "🔧 Setting up on server..."
ssh ${USER}@${SERVER} << 'ENDSSH'
cd /home/kykyryzik/cesium-route-renderer

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install dependencies
echo "📦 Installing server dependencies..."
cd server && npm install && cd ..

echo "📦 Installing telegram bot dependencies..."
cd telegram-bot && npm install && cd ..

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t cesium-route-recorder .

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

echo "✅ Setup complete!"
ENDSSH

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. SSH to server: ssh ${USER}@${SERVER}"
echo "2. Start services: cd ${DEPLOY_DIR} && ./start-services.sh"
