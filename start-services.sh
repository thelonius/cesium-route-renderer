#!/bin/bash

# Start all services using PM2

echo "🚀 Starting services..."

# Start API server
cd /home/kykyryzik/cesium-route-renderer/server
pm2 start index.js --name cesium-api --time

# Start Telegram bot
cd /home/kykyryzik/cesium-route-renderer/telegram-bot
pm2 start index.js --name telegram-bot --time

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd -u kykyryzik --hp /home/kykyryzik

echo "✅ Services started!"
echo ""
echo "Available commands:"
echo "  pm2 list          - View all services"
echo "  pm2 logs          - View logs"
echo "  pm2 logs cesium-api  - View API logs"
echo "  pm2 logs telegram-bot - View bot logs"
echo "  pm2 restart all   - Restart all services"
echo "  pm2 stop all      - Stop all services"
echo "  pm2 monit         - Monitor services"
