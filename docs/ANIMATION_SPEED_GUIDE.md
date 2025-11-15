# Animation Speed & Video Duration Guide

## How Animation Speed Affects Video Duration

### The Relationship

**Animation speed** controls how fast the route animation plays in the 3D visualization, but it **directly determines the final video duration**.

### Formula

```
Video Duration (seconds) = (GPX Route Duration / Animation Speed) + 19 seconds
```

**Where:**
- **GPX Route Duration** = Time between first and last GPS timestamp (in seconds)
- **Animation Speed** = Multiplier (e.g., 2x, 10x, 50x)
- **19 seconds** = Buffer time for intro/outro animations

### Example Calculations

#### Example 1: Short Route
- GPX Duration: 30 minutes (1800 seconds)
- Animation Speed: 2x
- **Video Duration** = (1800 / 2) + 19 = **919 seconds (~15 minutes)**

#### Example 2: Long Route with Adaptive Speed
- GPX Duration: 4 hours (14,400 seconds)
- Animation Speed: 25x (auto-increased by adaptive system)
- **Video Duration** = (14,400 / 25) + 19 = **595 seconds (~10 minutes)**

#### Example 3: Very Long Route
- GPX Duration: 8 hours (28,800 seconds)
- Animation Speed: 50x (auto-increased)
- **Video Duration** = (28,800 / 50) + 19 = **595 seconds (~10 minutes)**

### What Controls Animation Speed?

#### 1. Default Speed (settings.json)
```json
{
  "animation": {
    "defaultSpeed": 2
  }
}
```

#### 2. Adaptive Speed System
When `adaptiveSpeedEnabled: true`, the server automatically increases speed for long routes to keep videos under `maxVideoMinutes` (default: 10 minutes).

```javascript
// Adaptive calculation
const requiredSpeed = Math.ceil(routeDurationMinutes / (maxVideoMinutes - 0.5));
if (requiredSpeed > defaultSpeed) {
  animationSpeed = requiredSpeed; // Auto-increase
}
```

#### 3. Recording Duration Calculation (Docker)
The Docker recording script reads the GPX duration and animation speed to determine exactly how long to record:

```javascript
// docker/record-canvas.js
const gpxDuration = getGPXDuration(); // Seconds from GPX timestamps
const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '2');
const playbackDuration = gpxDuration / speedMultiplier;
const totalDuration = Math.ceil(playbackDuration + 19); // Add intro/outro buffer
```

### Why Videos Have Same Duration Despite Speed Changes

If you changed animation speed from 50x to 2x but videos still have the same duration, it's because:

1. **Adaptive Speed Override**: The adaptive system detected the route is long and automatically increased speed back to ~50x to keep video under 10 minutes
2. **Max Video Limit**: Check `settings.json` → `maxVideoMinutes` (default: 10)
3. **Route Length**: Long routes (> 2 hours) will always trigger adaptive speed increases

### How to Control Video Duration

#### Option 1: Increase Max Video Minutes
```json
{
  "animation": {
    "maxVideoMinutes": 20  // Allow longer videos
  }
}
```

#### Option 2: Disable Adaptive Speed
```json
{
  "animation": {
    "adaptiveSpeedEnabled": false  // Use fixed speed always
  }
}
```

⚠️ **Warning**: This can create very long videos (30+ minutes) that may fail to upload to Telegram (50 MB limit).

#### Option 3: Use API to Set Custom Speed
```bash
curl -X PUT http://localhost:3000/api/animation-speed \
  -H "Content-Type: application/json" \
  -d '{"speed": 5}'
```

### Video Duration in Output

The server now returns both `videoDurationSeconds` and `routeDurationMinutes` in the render response:

```json
{
  "success": true,
  "videoUrl": "/output/abc123/route-video.mp4",
  "fileSize": 15728640,
  "animationSpeed": 25,
  "videoDurationSeconds": 595,
  "routeDurationMinutes": "248.5",
  "logsUrl": "/logs/abc123"
}
```

The Telegram bot displays both durations in the video caption:

```
🎬 Your route video: my-hike.gpx

📊 Size: 15.0 MB (2100 kbps)
⏱️ Video: 9:55 | Route: 4h 8m
🎥 Format: 720x1280 (Vertical)
⚡ Animation: 25x speed
```

The bitrate is automatically calculated from the file size and video duration:
```
Bitrate (kbps) = (File Size in bytes × 8) / (Duration in seconds × 1000)
```

### Docker Status Display

During recording, the Docker container shows system information including route and video durations:

```
📊 [v1.0.0] Speed:25x | Route:249m→Video:9.9m | Map:Bing Maps | Terrain:High | FPS:24.5 | Frame:45.23ms
```

This status bar shows:
- **Speed**: Animation speed multiplier
- **Route**: Original route duration in minutes
- **Video**: Calculated video duration in minutes
- **Map**: Imagery provider (Bing Maps, Sentinel-2, etc.)
- **Terrain**: Quality level (Ultra High, High, Medium, Low)
- **FPS**: Average recording frame rate
- **Frame**: Average frame processing time

### Technical Details

#### Frame Rate
- Recording FPS: 24-30 fps (configurable via `RECORD_FPS`)
- Video FPS: Same as recording FPS
- **Formula**: `Total Frames = Video Duration × FPS`

#### Recording Process
1. Server calculates animation speed (considering adaptive rules)
2. Server calculates expected video duration
3. Docker container receives `ANIMATION_SPEED` env var
4. Recording script calculates recording duration from GPX + speed
5. Script captures exactly `duration × fps` frames
6. FFmpeg encodes frames to video at specified FPS

### Logs
The server logs show the calculation:

```
Route duration: 240.5 minutes
⚡ Route is long, increasing animation speed to 25x
Expected video length: ~9.6 minutes
📹 Expected video duration: 9.6 minutes (595s)
```

### Settings API

Get current settings:
```bash
curl http://localhost:3000/api/settings
```

Update animation settings:
```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "animation": {
      "defaultSpeed": 2,
      "maxVideoMinutes": 15,
      "adaptiveSpeedEnabled": true
    }
  }'
```

See full API documentation: [server/API.md](../server/API.md)
