# Quick Start Guide

## 1. Run the Setup Script

```bash
./setup.sh
```

This will:
- Build the Docker image
- Install API server dependencies
- Run a test recording

## 2. Start the API Server

```bash
cd server
npm start
```

The API will be available at `http://localhost:3000`

## 3. Render Your GPX File

### Using the Node.js client:

```bash
node client-example.js path/to/your-route.gpx 60
```

### Using curl:

```bash
curl -F "gpx=@public.virages.gpx" http://localhost:3000/render-route
```

## 4. Download Your Video

```bash
# Response from API will include the videoUrl
curl -O http://localhost:3000/output/route_XXXXX/route-video.mp4
```

## Example Output

```json
{
  "success": true,
  "videoUrl": "/output/route_1729425600/route-video.mp4",
  "outputId": "route_1729425600",
  "fileSize": 8421376,
  "duration": 60
}
```

## Full Documentation

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for complete documentation including:
- API endpoints
- Configuration options
- Troubleshooting
- Production deployment
