# Deployment to Custom Server

Server: **195.133.27.96**
User: **kykyryzik**
Password: **plow2018**

## Step 1: Connect to Server

```bash
ssh kykyryzik@195.133.27.96
# Password: plow2018
```

## Step 2: Check Server Requirements

Once connected, run:

```bash
# Check OS
cat /etc/os-release

# Check available space
df -h

# Check memory
free -h

# Check if Docker is installed
docker --version

# Check if Node.js is installed
node --version
```

## Step 3: Install Dependencies (if needed)

### Install Docker:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

### Install Node.js 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Install PM2 (Process Manager):
```bash
sudo npm install -g pm2
```

## Step 4: Upload Project Files

From your **local machine**:

```bash
# Create deployment directory
ssh kykyryzik@195.133.27.96 "mkdir -p ~/cesium-route-renderer"

# Upload project (excluding large files)
cd /Users/eddubnitsky/cesium/cesium-vite-react
rsync -avz -e ssh \
  --exclude 'node_modules' \
  --exclude 'output' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'temp' \
  --exclude 'public/cesium' \
  ./ kykyryzik@195.133.27.96:~/cesium-route-renderer/
```

## Step 5: Build on Server

Back on the **server**:

```bash
cd ~/cesium-route-renderer

# Install server dependencies
cd server && npm install && cd ..

# Install telegram bot dependencies
cd telegram-bot && npm install && cd ..

# Build Docker image (this may take 5-10 minutes)
docker build -t cesium-route-recorder .
```

## Step 6: Start Services with PM2

```bash
cd ~/cesium-route-renderer

# Start API server
cd server
pm2 start index.js --name cesium-api

# Start Telegram bot
cd ../telegram-bot
pm2 start index.js --name telegram-bot

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs
```

## Step 7: Verify Services

```bash
# Check if services are running
pm2 list

# View logs
pm2 logs cesium-api --lines 50
pm2 logs telegram-bot --lines 50

# Check if bot is responding
# Send /start to your Telegram bot
```

## Useful Commands

```bash
# View all services
pm2 list

# View logs
pm2 logs

# Restart services
pm2 restart all

# Stop services
pm2 stop all

# Monitor in real-time
pm2 monit

# View Docker images
docker images

# View Docker containers
docker ps -a
```

## Troubleshooting

### If Docker build fails:
```bash
# Check disk space
df -h

# Clean up old Docker images
docker system prune -a
```

### If services won't start:
```bash
# Check logs
pm2 logs

# Check ports
sudo netstat -tulpn | grep 3000

# Restart services
pm2 restart all
```

### If Telegram bot not responding:
```bash
# Check bot logs
pm2 logs telegram-bot

# Test API directly
curl http://localhost:3000/health
```

## Firewall Configuration

If needed, allow port 3000:
```bash
sudo ufw allow 3000
sudo ufw status
```

## Updates

To update the deployment:
```bash
# On local machine, upload new files
rsync -avz -e ssh \
  --exclude 'node_modules' \
  --exclude 'output' \
  ./ kykyryzik@195.133.27.96:~/cesium-route-renderer/

# On server, restart services
pm2 restart all
```
