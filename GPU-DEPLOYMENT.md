# GPU Server Deployment Guide

## New GPU Server Details
- **Server IP**: 195.209.214.96
- **User**: ubuntu
- **SSH Host Keys**: ED25519, ECDSA, RSA available

## Prerequisites on GPU Server

### 1. Install NVIDIA Drivers
```bash
# Check if NVIDIA GPU is detected
lspci | grep -i nvidia

# Install NVIDIA drivers (Ubuntu/Debian)
sudo apt update
sudo apt install -y nvidia-driver-535  # or latest stable version
sudo reboot

# Verify installation
nvidia-smi
```

### 2. Install NVIDIA Container Toolkit
```bash
# Add NVIDIA package repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install NVIDIA Container Toolkit
sudo apt update
sudo apt install -y nvidia-container-toolkit

# Configure Docker to use NVIDIA runtime
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Test GPU in Docker
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### 3. Install Docker (if not already installed)
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker installation
docker --version
docker run hello-world
```

### 4. Install Node.js and PM2
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Verify installations
node --version
npm --version
pm2 --version
```

### 5. Install Git
```bash
sudo apt install -y git
git --version
```

## Deployment Steps

### 1. Add Server to SSH Config
```bash
# Add to ~/.ssh/config
Host gpu-server
    HostName 195.209.214.96
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
```

### 2. Deploy Application
```bash
# From your local machine
./deploy-git.sh
```

This will:
- Push latest code to git
- SSH to GPU server
- Clone/pull repository
- Install dependencies
- Rebuild Docker image
- Restart API and Telegram bot services

### 3. Verify GPU Access
```bash
# SSH to server
ssh ubuntu@195.209.214.96

# Check if Docker can access GPU
docker run --rm --gpus all cesium-route-recorder nvidia-smi

# Check API logs for GPU detection
pm2 logs cesium-api | grep -i gpu
```

You should see:
```
✅ GPU device found, enabling hardware acceleration
```

### 4. Test Video Recording
```bash
# Trigger a test recording via Telegram bot
# Upload a GPX/KML file and check:
# 1. Recording completes successfully
# 2. GPU acceleration is used (faster rendering)
# 3. Check server logs for GPU usage
```

## GPU Configuration in Application

The application already has GPU support configured:

### Chromium GPU Flags (in Docker recording scripts)
```javascript
'--ignore-gpu-blacklist',
'--disable-gpu-vsync',
'--enable-gpu-rasterization',
'--enable-zero-copy',
'--use-gl=egl'
```

### GPU Detection (in server/index.js)
```javascript
if (gpuDevice) {
  console.log('✅ GPU device found, enabling hardware acceleration');
  process.env.LIBGL_ALWAYS_SOFTWARE = '0';
} else {
  console.log('⚠️  No GPU detected, using software rendering');
  process.env.LIBGL_ALWAYS_SOFTWARE = '1';
}
```

### Docker GPU Runtime
To enable GPU in Docker, use one of these methods:

**Option 1: Docker Run with --gpus flag**
```bash
docker run --gpus all cesium-route-recorder
```

**Option 2: Docker Compose** (create `docker-compose.yml`)
```yaml
version: '3.8'
services:
  recorder:
    image: cesium-route-recorder
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=graphics,video,compute,utility
```

## Performance Expectations

With GPU acceleration:
- **Rendering**: 2-5x faster than CPU-only
- **Memory**: Lower CPU memory usage
- **Quality**: Better frame consistency
- **Encoding**: Hardware H.264 encoding (if available)

## Troubleshooting

### Docker Can't Access GPU
```bash
# Check NVIDIA runtime
docker info | grep -i runtime

# Should show: Runtimes: nvidia runc

# If not, reinstall nvidia-container-toolkit
sudo apt remove --purge nvidia-container-toolkit
sudo apt install nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### GPU Not Detected in Container
```bash
# Check environment variables
docker run --rm --gpus all cesium-route-recorder env | grep NVIDIA

# Should show:
# NVIDIA_VISIBLE_DEVICES=all
# NVIDIA_DRIVER_CAPABILITIES=all
```

### Chromium Not Using GPU
```bash
# Check Chromium GPU info in logs
# Look for: GPU0: NVIDIA GeForce...
pm2 logs cesium-api
```

## Monitoring

### GPU Usage
```bash
# Real-time GPU monitoring
watch -n 1 nvidia-smi

# GPU usage during recording
pm2 logs cesium-api
```

### PM2 Process Monitoring
```bash
# List all processes
pm2 list

# View logs
pm2 logs

# Monitor resources
pm2 monit
```

## Rollback to Old Server

If needed, rollback to old server:

```bash
# Edit deploy-git.sh
SERVER="theo@195.133.27.96"

# Edit telegram-bot/index.js
const PUBLIC_URL = 'http://195.133.27.96:3000';

# Redeploy
./deploy-git.sh
```

## Next Steps

1. ✅ Configure GPU server prerequisites
2. ✅ Deploy application to GPU server
3. ✅ Verify GPU detection and acceleration
4. ✅ Test recording performance
5. ✅ Monitor GPU usage and optimize if needed
6. ✅ Update DNS/domain if applicable
