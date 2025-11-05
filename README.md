# Cesium Vite React

Minimal Vite + React + TypeScript starter that integrates CesiumJS.

Getting started

1. Install dependencies

```bash
npm install
```

2. Start dev server

```bash
npm run dev
```

Notes

- The `postinstall` script attempts to copy Cesium's static build assets into `public/cesium` so Cesium can load workers and static assets from `/cesium/` at runtime. If the script fails, run `node scripts/copy-cesium-assets.js` after install.
- On macOS you may need to allow npm to create files in the project folder if permissions are restricted.

Recording / Runtime environment variables
--------------------------------------

The recorder and server support several environment variables you can use to tune recordings or run in a headless-friendly mode.

- HEADLESS=1
	- When set inside the container (the API now passes this automatically), the recorder will prefer stable, lower-quality defaults (30 fps, 720x1280) to improve reliability in headless/container environments.

- RECORD_FPS, RECORD_WIDTH, RECORD_HEIGHT
	- Explicitly override the recorder's target FPS and resolution. These take precedence over HEADLESS defaults.
	- Example: `RECORD_FPS=60 RECORD_WIDTH=1080 RECORD_HEIGHT=1920`

- GPX_FILENAME
	- Filename of the GPX that the recorder should load (the API sets this when launching Docker).

- ANIMATION_SPEED
	- Controls the route playback speed multiplier inside the recorder (default set by the API to 100).

Examples
```
# Run the container with headless-friendly defaults (what the API does):
docker run --rm -e HEADLESS=1 -e GPX_FILENAME=virages.gpx -v /host/output:/output cesium-route-recorder

# Force high-quality 60fps 1080x1920 recording even in headless mode:
docker run --rm -e HEADLESS=1 -e RECORD_FPS=60 -e RECORD_WIDTH=1080 -e RECORD_HEIGHT=1920 -e GPX_FILENAME=virages.gpx -v /host/output:/output cesium-route-recorder
```

Telegram Bot Usage
------------------

The bot provides several commands for managing and monitoring renders:

### Commands

- **Send GPX file** - Upload a .gpx file to start rendering
  - Bot responds immediately with a unique render ID
  - Click "📋 View Logs" button to monitor progress in real-time

- `/status` - Check current render status and output ID

- `/logs` - View logs for your last render
  - Shows real-time progress during rendering
  - Includes detailed Docker and FFmpeg output
  - Click "🔄 Refresh Logs" to update

- `/cleanup` - Delete old renders (>7 days) to free disk space

### Checking Logs

Logs are available through:

1. **Inline Buttons**: Click "📋 View Logs" in any render message
2. **`/logs` Command**: Shows logs from your most recent render
3. **Direct API** (replace `{outputId}` with your actual render ID):
   - JSON: `GET http://your-server:3000/logs/{outputId}`
   - Text: `GET http://your-server:3000/logs/{outputId}/text`
   - Example: `http://your-server:3000/logs/render-1730736000000-abc123/text`

**Note**: The outputId is provided when you submit a GPX file. Logs become available after the Docker container starts. If you see "Output directory not found", either the render hasn't started yet or the outputId is incorrect.

**Note**: Logs become available after the Docker container starts. If you see "Logs not found yet", wait a few seconds and click "Try Again".

### Render Process Stages

1. 📤 **GPX Upload** - File received, render ID generated
2. 🚀 **API Submission** - GPX sent to render API
3. 🐳 **Docker Starting** - Container launching (logs appear here)
4. 🎬 **Recording** - Puppeteer capturing animation
5. 🎞️ **Encoding** - FFmpeg creating video (can take 30-45 min for long routes)
6. ✅ **Complete** - Video ready for download
