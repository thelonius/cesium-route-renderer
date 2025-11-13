#!/bin/bash

# Setup script for GPU server
# Run this once to install all prerequisites

set -e

SERVER="ubuntu@195.209.214.96"
SSH_KEY="$HOME/.ssh/gpu-server.pem"

echo "🔧 Setting up GPU server prerequisites..."

ssh -i $SSH_KEY $SERVER << 'ENDSSH'
set -e

echo "📦 Updating system..."
sudo apt update

echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "📦 Installing PM2..."
sudo npm install -g pm2

echo "📦 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

echo "📦 Installing Git..."
sudo apt install -y git

echo "📦 Installing NVIDIA drivers..."
sudo apt install -y nvidia-driver-535

echo "📦 Installing NVIDIA Container Toolkit..."
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit

echo "📦 Configuring Docker for NVIDIA runtime..."
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

echo "✅ Setup complete! Server needs reboot for NVIDIA drivers."
echo "Run: sudo reboot"

ENDSSH

echo ""
echo "✅ Server setup complete!"
echo "⚠️  Server needs to reboot for NVIDIA drivers to take effect"
echo "🔄 Reboot command: ssh -i $SSH_KEY $SERVER 'sudo reboot'"
echo "⏳ After reboot, run: ./deploy-git.sh"
