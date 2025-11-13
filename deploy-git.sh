#!/bin/bash

# Git-based deployment script with GPU support
# This assumes you've committed your changes to git

set -e

SERVER="ubuntu@195.209.214.96"
SSH_KEY="$HOME/.ssh/gpu-server.pem"
DEPLOY_DIR="cesium-route-renderer"
BRANCH="${1:-main}"

echo "🚀 Deploying branch: $BRANCH to GPU server"

# Step 1: Ensure local changes are committed
if [[ -n $(git status -s) ]]; then
    echo "❌ You have uncommitted changes. Please commit or stash them first."
    echo ""
    git status -s
    exit 1
fi

# Step 2: Push to remote
echo "📤 Pushing to git remote..."
git push origin $BRANCH

# Step 3: Deploy on server
echo "🔧 Deploying on server..."
ssh -i $SSH_KEY $SERVER << ENDSSH
set -e

# Create directory if doesn't exist
mkdir -p ~/$DEPLOY_DIR

cd ~/$DEPLOY_DIR

# Check if git repo exists
if [ ! -d .git ]; then
    echo "📦 Cloning repository for the first time..."
    cd ..
    rm -rf $DEPLOY_DIR
    git clone https://github.com/thelonius/cesium-route-renderer.git $DEPLOY_DIR
    cd $DEPLOY_DIR
else
    echo "🔄 Pulling latest changes..."
    git fetch origin
    git checkout $BRANCH
    git pull origin $BRANCH
fi

# Install/update dependencies
echo "📦 Installing server dependencies..."
cd server && npm install && cd ..

echo "📦 Installing telegram bot dependencies..."
cd telegram-bot && npm install && cd ..

# Rebuild Docker image with GPU support
echo "🐳 Rebuilding Docker image with GPU support..."
docker build -t cesium-route-recorder .

# Restart services
echo "♻️  Restarting services..."
pm2 restart cesium-api || pm2 start server/index.js --name cesium-api
pm2 restart telegram-bot || pm2 start telegram-bot/index.js --name telegram-bot --env PUBLIC_URL="http://195.209.214.96:3000"
pm2 save

echo "✅ Deployment complete on GPU server!"
ENDSSH

echo ""
echo "✅ Deployed successfully!"
echo "📊 Check status: ssh -i $SSH_KEY $SERVER 'pm2 list'"
echo "📝 View logs: ssh -i $SSH_KEY $SERVER 'pm2 logs'"
