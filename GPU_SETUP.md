# GPU Setup Guide for Cesium Route Renderer

## Requirements

- NVIDIA GPU (RTX 3080/3090/4090 recommended)
- NVIDIA drivers 525+ installed on host
- Docker with nvidia-container-toolkit

## Host Setup (Ubuntu 22.04)

### 1. Install NVIDIA Drivers

```bash
# Add NVIDIA driver repository
sudo apt update
sudo apt install -y nvidia-driver-535

# Reboot
sudo reboot
```

### 2. Verify GPU

```bash
nvidia-smi
```

### 3. Install nvidia-container-toolkit

```bash
# Add NVIDIA container repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Install
sudo apt update
sudo apt install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 4. Verify Docker GPU Access

```bash
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

## Build GPU Docker Image

```bash
cd cesium-route-renderer
docker build -f Dockerfile.gpu -t cesium-route-recorder:gpu .
```

## Run with GPU

### Option 1: Environment Variable

```bash
export USE_GPU=true
pm2 restart cesium-api
```

### Option 2: Direct Docker Run

```bash
docker run --gpus all --rm \
  -v /path/to/route.gpx:/app/dist/route.gpx:ro \
  -v /path/to/output:/output \
  -e GPX_FILENAME=route.gpx \
  -e ANIMATION_SPEED=10 \
  cesium-route-recorder:gpu
```

## Expected Performance

| Mode | Frame Time | 274 frames |
|------|------------|------------|
| SwiftShader (CPU) | 6-8 sec | ~30 min |
| RTX 4090 | 0.05-0.1 sec | ~30 sec |

## Troubleshooting

### "could not select device driver"

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Chrome crashes with GPU

Try adding to Docker run:
```bash
--env NVIDIA_DRIVER_CAPABILITIES=all
--env __GLX_VENDOR_LIBRARY_NAME=nvidia
```

### Check GPU usage during render

```bash
watch -n 1 nvidia-smi
```
