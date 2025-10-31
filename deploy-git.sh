#!/bin/bash

# Git-based deployment script
# This assumes you've committed your changes to git

set -e

SERVER="kykyryzik@195.133.27.96"
DEPLOY_DIR="cesium-route-renderer"
BRANCH="${1:-main}"

echo "🚀 Deploying branch: $BRANCH"

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
ssh $SERVER << ENDSSH
set -e

# Create directory if doesn't exist
mkdir -p ~/$DEPLOY_DIR

cd ~/$DEPLOY_DIR

# Check if git repo exists
if [ ! -d .git ]; then
    echo "📦 Cloning repository for the first time..."
    cd ..
    rm -rf $DEPLOY_DIR
    # Replace with your actual git repository URL
    git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git $DEPLOY_DIR
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

# Rebuild Docker image
echo "🐳 Rebuilding Docker image..."
docker build -t cesium-route-recorder .

# Restart services
echo "♻️  Restarting services..."
pm2 restart cesium-api || pm2 start server/index.js --name cesium-api
pm2 restart telegram-bot || pm2 start telegram-bot/index.js --name telegram-bot
pm2 save

echo "✅ Deployment complete!"
ENDSSH

echo ""
echo "✅ Deployed successfully!"
echo "📊 Check status: ssh $SERVER 'pm2 list'"
echo "📝 View logs: ssh $SERVER 'pm2 logs'"
