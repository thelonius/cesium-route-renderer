# Cesium Route Recorder - Docker Setup

This setup allows you to render Cesium hiking route animations as videos by submitting GPX files to an API.

## Architecture

```
Client → API Server → Docker Container → Video Output
         (Express)    (Puppeteer + Cesium)
```

## Quick Start

### 1. Build the Docker Image

```bash
docker build -t cesium-route-recorder .
```

This creates a container with:
- Cesium app (built)
- Chromium browser
- Puppeteer for automation
- FFmpeg for video encoding

### 2. Test Direct Recording (Optional)

Test the recorder with the default GPX file:

```bash
docker run --rm \
  -v $(pwd)/output:/output \
  -e RECORD_DURATION=60 \
  cesium-route-recorder
```

Output: `./output/route-video.mp4`

### 3. Start the API Server

```bash
cd server
npm install
npm start
```

The API runs on `http://localhost:3000`

### 4. Submit a GPX File

Using curl:

```bash
curl -F "gpx=@path/to/your-route.gpx" \
     -F "duration=60" \
     http://localhost:3000/render-route
```

Using the Node.js client:

```bash
node client-example.js path/to/your-route.gpx 60
```

### 5. Download the Video

The API returns:

```json
{
  "success": true,
  "videoUrl": "/output/route_1234567890/route-video.mp4",
  "outputId": "route_1234567890",
  "fileSize": 12345678,
  "duration": 60
}
```

Download:

```bash
curl -O http://localhost:3000/output/route_1234567890/route-video.mp4
```

## API Endpoints

### POST `/render-route`

Submit a GPX file for rendering.

**Request:**
- `gpx` (file, required): GPX file to render
- `duration` (number, optional): Recording duration in seconds (default: 60)

**Response:**
```json
{
  "success": true,
  "videoUrl": "/output/route_XXX/route-video.mp4",
  "outputId": "route_XXX",
  "fileSize": 12345678,
  "duration": 60
}
```

### GET `/status/:outputId`

Check the status of a render job.

**Response:**
```json
{
  "status": "complete",
  "videoUrl": "/output/route_XXX/route-video.mp4",
  "fileSize": 12345678
}
```

Possible statuses: `complete`, `processing`, `not_found`

### GET `/health`

Health check endpoint.

## Configuration

### Environment Variables

**Docker Container:**
- `RECORD_DURATION`: Recording duration in seconds (default: 60)

**API Server:**
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (default: development)

### Recording Duration

The default GPX file has a ~95 minute route. With `clock.multiplier = 10`, it plays in ~9.5 minutes.

Recommended durations:
- **60 seconds**: Quick preview
- **120 seconds**: Full route at 10x speed
- **570 seconds**: Full route at 1x speed

Adjust in the API request or container environment variable.

## Docker Compose (Alternative)

For a complete setup with API server:

```bash
docker-compose up -d
```

This starts the API server with Docker socket access.

## Troubleshooting

### Video file not created

Check Docker logs:
```bash
docker logs <container_id>
```

Common issues:
- Insufficient memory (increase Docker memory limit)
- Chromium crash (check GPU settings)
- Terrain loading timeout (increase wait time in record-puppeteer.js)

### API returns 500 error

Check:
1. Docker image is built: `docker images | grep cesium-route-recorder`
2. Docker daemon is running
3. Server has permission to run Docker commands

### Video is blank/black

- Cesium may need more time to load terrain
- Increase the initial wait time in `docker/record-puppeteer.js` (line 55)
- Check Cesium Ion token is valid

## Customization

### Change Video Resolution

Edit `docker/record-puppeteer.js`:

```javascript
await page.setViewport({ width: 3840, height: 2160 }); // 4K
```

### Change FPS

Edit `docker/record-puppeteer.js`:

```javascript
const recorder = new PuppeteerScreenRecorder(page, {
  fps: 60, // Change from 30 to 60
  // ...
});
```

### Change Animation Speed

Edit `src/CesiumViewer.tsx`:

```typescript
viewer.clock.multiplier = 20; // Change from 10 to 20 (2x faster)
```

Rebuild the Docker image after changes.

## Performance

**Typical render times:**
- 60s video: ~2-3 minutes
- 120s video: ~4-5 minutes

**Resource usage:**
- CPU: 1-2 cores
- RAM: 2-4 GB
- Disk: ~50-100 MB per video

## Production Deployment

For production use:

1. Add authentication to the API
2. Add rate limiting
3. Clean up old output files periodically
4. Use a proper video encoding queue (e.g., Bull, BeeQueue)
5. Store videos in S3/cloud storage
6. Add progress tracking/webhooks

## License

Same as the main project.
