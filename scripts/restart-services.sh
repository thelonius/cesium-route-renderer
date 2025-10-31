#!/usr/bin/env bash
set -euo pipefail

# Restart and deploy services on the host.
# Usage: ./scripts/restart-services.sh

REPO_DIR="/home/kykyryzik/cesium-route-renderer"
BRANCH="main"
DOCKER_IMAGE_NAME="cesium-route-recorder"

echo "-- Restart script starting at $(date -u +%Y-%m-%dT%H:%M:%SZ) --"

if [ "$EUID" -eq 0 ]; then
  echo "Warning: running as root. Recommended to run as the deploy user (kykyryzik)."
fi

if [ ! -d "$REPO_DIR" ]; then
  echo "Error: repo dir $REPO_DIR does not exist. Adjust REPO_DIR in this script." >&2
  exit 2
fi

cd "$REPO_DIR"

echo "Fetching latest from origin/$BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "Installing server dependencies..."
if [ -d "server" ]; then
  cd server
  npm ci --production
  cd ..
else
  echo "Warning: server folder not found, skipping npm install for server"
fi

echo "Installing telegram-bot dependencies..."
if [ -d "telegram-bot" ]; then
  cd telegram-bot
  npm ci --production
  cd ..
else
  echo "Warning: telegram-bot folder not found, skipping npm install for telegram-bot"
fi

# Rebuild docker image to pick up changes in docker/ or recorder script
if command -v docker >/dev/null 2>&1; then
  echo "Building Docker image: $DOCKER_IMAGE_NAME"
  docker build -t "$DOCKER_IMAGE_NAME" .
else
  echo "Docker not found in PATH; skipping docker build." >&2
fi

# Restart or start PM2 services
echo "Restarting PM2 processes..."
set +e
pm2 restart cesium-api
PM2_API_EXIT=$?
if [ $PM2_API_EXIT -ne 0 ]; then
  echo "Starting cesium-api via PM2"
  pm2 start server/index.js --name cesium-api --update-env --time
fi

pm2 restart telegram-bot
PM2_BOT_EXIT=$?
if [ $PM2_BOT_EXIT -ne 0 ]; then
  echo "Starting telegram-bot via PM2"
  pm2 start telegram-bot/index.js --name telegram-bot --update-env --time
fi
set -e

# Persist PM2 process list and show status
pm2 save

echo "-- Restart complete --"
pm2 list || true

exit 0
