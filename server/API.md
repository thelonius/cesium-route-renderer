# API Server Endpoints

## Base URL
`http://localhost:3000` (or your server URL)

---

## Endpoints

### 1. Render Route
**POST** `/render-route`

Upload a GPX file to render an animated route video.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `gpx` (file): The GPX file to render

**Response (Success):**
```json
{
  "success": true,
  "videoUrl": "/output/route_1234567890/route-video.mp4",
  "outputId": "route_1234567890",
  "fileSize": 12345678,
  "logsUrl": "/logs/route_1234567890",
  "logsTextUrl": "/logs/route_1234567890/text"
}
```

**Response (Error):**
```json
{
  "error": "Failed to render video",
  "details": "Error message",
  "stdout": "Docker stdout...",
  "stderr": "Docker stderr..."
}
```

---

### 2. Get Render Status
**GET** `/status/:outputId`

Check the status of a render job.

**Parameters:**
- `outputId`: The output ID returned from `/render-route`

**Response (Complete):**
```json
{
  "status": "complete",
  "videoUrl": "/output/route_1234567890/route-video.mp4",
  "fileSize": 12345678,
  "logsUrl": "/logs/route_1234567890"
}
```

**Response (Processing):**
```json
{
  "status": "processing",
  "logsUrl": "/logs/route_1234567890"
}
```

**Response (Not Found):**
```json
{
  "status": "not_found"
}
```

---

### 3. Get Logs (JSON)
**GET** `/logs/:outputId`

Retrieve logs for a render job in JSON format.

**Parameters:**
- `outputId`: The output ID of the render job

**Response:**
```json
{
  "outputId": "route_1234567890",
  "standardLog": "Full content of recorder.log...",
  "errorLog": "Full content of recorder-error.log (or 'No errors logged')...",
  "timestamp": "2025-11-04T12:34:56.789Z"
}
```

---

### 4. Get Logs (Text) - **For Telegram**
**GET** `/logs/:outputId/text`

Retrieve logs in plain text format, optimized for Telegram messages.

**Parameters:**
- `outputId`: The output ID of the render job

**Response:**
```
=== Logs for route_1234567890 ===
Timestamp: 2025-11-04T12:34:56.789Z

=== Standard Log ===
[2025-11-04T12:34:00.000Z] Starting route recording...
[2025-11-04T12:34:05.000Z] Server running at http://localhost:8080
[2025-11-04T12:34:10.000Z] Loading Cesium app with GPX: 1234567890.gpx
...

=== Error Log ===
No errors logged
```

**Note:** The text output is automatically truncated to ~4000 characters for the standard log to fit within Telegram's message limit.

---

### 5. Download Video
**GET** `/output/:outputId/route-video.mp4`

Direct download link for the rendered video.

---

### 6. Health Check
**GET** `/health`

Check if the server is running.

**Response:**
```json
{
  "status": "ok"
}
```

---

## Usage Examples

### Using curl

**Render a route:**
```bash
curl -X POST http://localhost:3000/render-route \
  -F "gpx=@route.gpx"
```

**Check status:**
```bash
curl http://localhost:3000/status/route_1234567890
```

**Get logs (JSON):**
```bash
curl http://localhost:3000/logs/route_1234567890
```

**Get logs (Text):**
```bash
curl http://localhost:3000/logs/route_1234567890/text
```

### For Telegram Bot Integration

When processing the response from `/render-route`, you can:

1. **Send the video:**
   ```javascript
   const videoUrl = `${serverUrl}${response.videoUrl}`;
   await bot.sendVideo(chatId, videoUrl);
   ```

2. **Send logs if needed:**
   ```javascript
   const logsText = await fetch(`${serverUrl}${response.logsTextUrl}`).then(r => r.text());
   await bot.sendMessage(chatId, logsText);
   ```

3. **Poll status while processing:**
   ```javascript
   const checkStatus = async () => {
     const status = await fetch(`${serverUrl}/status/${outputId}`).then(r => r.json());
     if (status.status === 'processing') {
       // Still processing, check logs if needed
       const logs = await fetch(`${serverUrl}${status.logsUrl}/text`).then(r => r.text());
       console.log(logs);
     }
   };
   ```

---

## Log Files Location

Logs are stored in the output directory for each render job:
- **Standard log:** `/output/<outputId>/recorder.log`
- **Error log:** `/output/<outputId>/recorder-error.log`

These files contain:
- Docker execution logs
- Puppeteer browser logs
- Cesium app console output
- Recording progress
- Error stack traces (if any)
