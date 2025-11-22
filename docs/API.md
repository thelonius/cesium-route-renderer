# API Documentation

Complete reference for the Cesium Route Renderer REST API.

## Base URL

```
http://localhost:3000
```

Production: Replace with your domain.

---

## Authentication

Currently no authentication required. Add authentication middleware for production deployments.

---

## Endpoints

### 1. Render Route

Start a new route render job.

**Endpoint**: `POST /render-route`

**Content-Type**: `multipart/form-data`

**Request Body**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gpx` | File | Yes | GPX or KML file |
| `userName` | String | No | User name for personalization |
| `outputId` | String | No | Custom output ID (auto-generated if not provided) |

**Example Request**:
```bash
curl -X POST http://localhost:3000/render-route \
  -F "gpx=@route.gpx" \
  -F "userName=John" \
  -F "outputId=my-custom-id"
```

**Success Response** (202 Accepted):
```json
{
  "success": true,
  "outputId": "render-1699564800000-abc123",
  "message": "Render started successfully",
  "estimatedDuration": 45,
  "videoUrl": "http://localhost:3000/output/render-1699564800000-abc123/route-video.mp4"
}
```

**Error Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "No GPX file provided"
}
```

---

### 2. Get Render Status

Query the status of a render job.

**Endpoint**: `GET /status/:outputId`

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `outputId` | String | Render output ID |

**Example Request**:
```bash
curl http://localhost:3000/status/render-1699564800000-abc123
```

**Response** (200 OK):
```json
{
  "success": true,
  "outputId": "render-1699564800000-abc123",
  "status": "rendering",
  "stage": "execution",
  "progress": 65,
  "currentFrame": 450,
  "totalFrames": 700,
  "elapsedTime": 1200,
  "estimatedTimeRemaining": 600,
  "details": {
    "routePattern": "alpine_ridge",
    "animationSpeed": 5,
    "videoLength": 180
  }
}
```

**Status Values**:
- `queued`: Waiting to start
- `analyzing`: Analyzing route
- `preparing`: Preparing files
- `rendering`: Recording video
- `encoding`: Encoding video
- `completed`: Render finished
- `failed`: Render failed

---

### 3. Get Render Logs

Retrieve logs for a render job.

**Endpoint**: `GET /logs/:outputId`

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `outputId` | String | Render output ID |

**Example Request**:
```bash
curl http://localhost:3000/logs/render-1699564800000-abc123
```

**Response** (200 OK):
```json
{
  "success": true,
  "outputId": "render-1699564800000-abc123",
  "logs": [
    {
      "timestamp": 1699564800000,
      "level": "info",
      "message": "Starting Docker container"
    },
    {
      "timestamp": 1699564805000,
      "level": "info",
      "message": "Recording frame 120/700"
    }
  ],
  "logsUrl": "http://localhost:3000/logs/render-1699564800000-abc123/text"
}
```

---

### 4. Get Render Logs (Text)

Retrieve raw text logs for a render job.

**Endpoint**: `GET /logs/:outputId/text`

**Example Request**:
```bash
curl http://localhost:3000/logs/render-1699564800000-abc123/text
```

**Response** (200 OK):
```
[2024-11-09 10:00:00] INFO: Starting Docker container
[2024-11-09 10:00:05] INFO: Cesium viewer initialized
[2024-11-09 10:00:10] INFO: Recording frame 120/700 (17%)
[2024-11-09 10:00:15] INFO: Recording frame 240/700 (34%)
...
```

---

### 5. List Active Renders

Get all currently active render jobs.

**Endpoint**: `GET /api/active-renders`

**Example Request**:
```bash
curl http://localhost:3000/api/active-renders
```

**Response** (200 OK):
```json
{
  "success": true,
  "count": 2,
  "activeRenders": [
    {
      "outputId": "render-123",
      "userName": "John",
      "stage": "execution",
      "progress": 45,
      "startTime": 1699564800000,
      "elapsedTime": 600
    },
    {
      "outputId": "render-456",
      "userName": "Jane",
      "stage": "encoding",
      "progress": 85,
      "startTime": 1699563600000,
      "elapsedTime": 1800
    }
  ]
}
```

---

### 6. Cancel Render

Cancel an active render job.

**Endpoint**: `DELETE /render/:outputId`

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `outputId` | String | Render output ID |

**Example Request**:
```bash
curl -X DELETE http://localhost:3000/render/render-1699564800000-abc123
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "message": "Render cancelled successfully",
  "outputId": "render-1699564800000-abc123"
}
```

**Error Response** (404 Not Found):
```json
{
  "success": false,
  "error": "Render not found or already completed"
}
```

---

### 7. System Statistics

Get system-wide statistics.

**Endpoint**: `GET /api/stats`

**Example Request**:
```bash
curl http://localhost:3000/api/stats
```

**Response** (200 OK):
```json
{
  "success": true,
  "uptime": 3600,
  "memory": {
    "heapUsed": 150.5,
    "heapTotal": 512.0,
    "rss": 800.2,
    "external": 50.1
  },
  "docker": {
    "containersRunning": 1,
    "containersTotal": 15
  },
  "output": {
    "totalRenders": 42,
    "totalSizeMB": 1024.8,
    "oldestRender": "2024-10-01T10:00:00Z",
    "newestRender": "2024-11-09T15:30:00Z"
  },
  "activeRenders": 1
}
```

---

### 8. Get Settings

Retrieve current system settings.

**Endpoint**: `GET /api/settings`

**Example Request**:
```bash
curl http://localhost:3000/api/settings
```

**Response** (200 OK):
```json
{
  "success": true,
  "settings": {
    "maxVideoDuration": 60,
    "defaultAnimationSpeed": 2,
    "minAnimationSpeed": 2,
    "maxAnimationSpeed": 10,
    "adaptiveBufferMinutes": 5,
    "videoSettings": {
      "width": 1920,
      "height": 1080,
      "fps": 60,
      "codec": "libx264"
    }
  }
}
```

---

### 9. Update Settings

Update system settings.

**Endpoint**: `PUT /api/settings`

**Content-Type**: `application/json`

**Request Body**:
```json
{
  "maxVideoDuration": 90,
  "defaultAnimationSpeed": 3,
  "videoSettings": {
    "width": 3840,
    "height": 2160,
    "fps": 30
  }
}
```

**Example Request**:
```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"maxVideoDuration": 90}'
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Settings updated successfully",
  "settings": {
    "maxVideoDuration": 90,
    "defaultAnimationSpeed": 2,
    ...
  }
}
```

---

### 10. Get Camera Settings

Retrieve camera configuration.

**Endpoint**: `GET /api/camera-settings`

**Example Request**:
```bash
curl http://localhost:3000/api/camera-settings
```

**Response** (200 OK):
```json
{
  "success": true,
  "cameraSettings": {
    "defaultStrategy": "follow",
    "strategies": {
      "follow": {
        "followDistance": 50,
        "followHeight": 30,
        "lookAheadDistance": 20,
        "smoothingFactor": 0.7
      },
      "cinematic": {
        "followDistance": 80,
        "followHeight": 50,
        "lookAheadDistance": 40,
        "smoothingFactor": 0.85
      },
      "birds-eye": {
        "followDistance": 0,
        "followHeight": 500,
        "lookAheadDistance": 100,
        "smoothingFactor": 0.9
      }
    }
  }
}
```

---

### 11. Update Camera Settings

Update camera configuration.

**Endpoint**: `PUT /api/camera-settings`

**Content-Type**: `application/json`

**Request Body**:
```json
{
  "defaultStrategy": "cinematic",
  "strategies": {
    "follow": {
      "followDistance": 60,
      "followHeight": 35
    }
  }
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Camera settings updated successfully",
  "cameraSettings": { ... }
}
```

---

### 12. Get Camera Profile

Get camera adjustments for a specific route pattern.

**Endpoint**: `GET /api/camera-profile/:patternType`

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `patternType` | String | Route pattern type |

**Pattern Types**:
- `technical_climb`
- `scenic_overlook`
- `alpine_ridge`
- `valley_traverse`
- `switchback_section`
- `flat_approach`
- `unknown`

**Example Request**:
```bash
curl http://localhost:3000/api/camera-profile/alpine_ridge
```

**Response** (200 OK):
```json
{
  "success": true,
  "patternType": "alpine_ridge",
  "adjustments": {
    "distanceMultiplier": 1.8,
    "heightMultiplier": 1.4,
    "pitchAdjustment": -5,
    "smoothingMultiplier": 0.85,
    "lookAheadMultiplier": 1.5
  }
}
```

---

### 13. Cleanup Old Renders

Delete renders older than specified days.

**Endpoint**: `GET /cleanup`

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `daysOld` | Number | 7 | Age threshold in days |

**Example Request**:
```bash
curl "http://localhost:3000/cleanup?daysOld=7"
```

**Response** (200 OK):
```json
{
  "success": true,
  "deletedFolders": 5,
  "freedSpaceMB": 512.5,
  "message": "Cleaned up 5 folders, freed 512.5 MB"
}
```

---

### 14. Health Check

Check API health and readiness.

**Endpoint**: `GET /health`

**Example Request**:
```bash
curl http://localhost:3000/health
```

**Response** (200 OK):
```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": 1699564800000,
  "memory": {
    "heapUsed": 150.5,
    "heapTotal": 512.0
  },
  "docker": {
    "available": true,
    "version": "24.0.5"
  },
  "activeRenders": 1
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 202 | Accepted (async operation started) |
| 400 | Bad Request (invalid parameters) |
| 404 | Not Found (resource doesn't exist) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (Docker not available) |

## Error Response Format

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

---

## Rate Limiting

Currently no rate limiting. Recommended for production:
- 100 requests/minute per IP
- 10 concurrent renders per user

---

## Webhooks (Planned)

Future support for webhooks on render completion:

```json
{
  "event": "render.completed",
  "outputId": "render-123",
  "videoUrl": "http://...",
  "timestamp": 1699564800000
}
```

---

## SDK Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function renderRoute(gpxPath) {
  const form = new FormData();
  form.append('gpx', fs.createReadStream(gpxPath));
  form.append('userName', 'John');

  const response = await axios.post('http://localhost:3000/render-route', form, {
    headers: form.getHeaders()
  });

  return response.data.outputId;
}

async function checkStatus(outputId) {
  const response = await axios.get(`http://localhost:3000/status/${outputId}`);
  return response.data;
}
```

### Python

```python
import requests

def render_route(gpx_path):
    with open(gpx_path, 'rb') as f:
        files = {'gpx': f}
        data = {'userName': 'John'}
        response = requests.post('http://localhost:3000/render-route',
                                files=files, data=data)
        return response.json()['outputId']

def check_status(output_id):
    response = requests.get(f'http://localhost:3000/status/{output_id}')
    return response.json()
```

### cURL Examples

See individual endpoint documentation above.

---

## Best Practices

1. **Poll status endpoint** every 5-10 seconds, not continuously
2. **Check logs** only when needed, not in polling loop
3. **Cancel renders** that are no longer needed to free resources
4. **Clean up old renders** regularly to save disk space
5. **Use custom outputId** for tracking user-specific renders
6. **Validate GPX files** client-side before uploading
7. **Handle errors** gracefully with retry logic
8. **Monitor system stats** to prevent overload

---

## Support

For API issues or questions:
- GitHub Issues: https://github.com/yourusername/cesium-route-renderer/issues
- Email: api-support@your-domain.com
