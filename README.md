# Cesium Route Renderer

**Production-ready route visualization system** that transforms GPX/KML files into cinematic 3D flythrough videos using CesiumJS, React, and Docker.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 Features

### Core Capabilities
- **📍 Route Analysis**: Automatic detection of 7 route patterns (technical climbs, alpine ridges, switchbacks, etc.)
- **🎥 Dynamic Camera**: 4 camera strategies (follow, cinematic, bird's-eye, static) with pattern-aware adjustments
- **⚡ Adaptive Speed**: Automatic animation speed calculation (2-10x) to fit routes into optimal video duration
- **🎬 High-Quality Recording**: 1080p/4K video generation via headless Chrome and FFmpeg
- **📊 Progress Tracking**: Real-time render progress with 5-stage pipeline monitoring
- **💾 Memory Management**: Advanced memory monitoring with leak detection and cleanup recommendations
- **🤖 Telegram Integration**: Full-featured bot for GPX file processing and video delivery
- **🏗️ Service Architecture**: Modular, testable services with comprehensive error handling

### Advanced Features
- Pattern-based camera adjustments (pull back on climbs, swing wide on turns)
- Keyframe interpolation with ease-in-out smoothing
- Route segment detection (climbs, descents, turns, flats)
- Memory threshold alerts (warning/critical) with trend analysis
- Docker lifecycle management with automatic cleanup
- Multi-language support (EN/RU) in Telegram bot
- File-based state persistence for bot history

---

## 📁 Architecture

### System Overview

```
┌──────────────────┐
│  Telegram Bot    │ ← User uploads GPX
│  (Node.js)       │
└────────┬─────────┘
         │ POST /render-route
         ↓
┌──────────────────┐
│  Express Server  │ ← API endpoints
│  (Node.js)       │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ Services │ ← Business logic
    └────┬────┘
         │
    ┌────┴────────────┐
    │ Docker Container │ ← Puppeteer + Cesium
    │ (Headless Chrome)│
    └─────────────────┘
```

### Service Layer Architecture

```
server/services/
├── settingsService.js           # Configuration management
├── gpxService.js                 # GPX/KML parsing
├── animationSpeedService.js      # Speed calculation (1154 lines)
├── routeAnalyzerService.js       # Route analysis orchestrator (396 lines)
├── dockerService.js              # Container lifecycle (351 lines)
├── memoryMonitorService.js       # Memory tracking (489 lines)
└── renderOrchestratorService.js  # Render pipeline coordinator (550 lines)

telegram-bot/services/
├── apiService.js                 # API communication (362 lines)
├── stateService.js               # State management (280 lines)
└── botHandlersService.js         # Command handlers (621 lines)

src/services/
└── cesiumCameraService.ts        # Camera strategies (856 lines)
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 18+ (with npm)
- **Docker**: 20.10+ (for video rendering)
- **Telegram Bot**: Token from [@BotFather](https://t.me/botfather) (optional)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/yourusername/cesium-route-renderer.git
cd cesium-route-renderer

# 2. Install dependencies
npm install
cd telegram-bot && npm install && cd ..

# 3. Copy Cesium assets
node scripts/copy-cesium-assets.js

# 4. Configure environment
cp .env.example .env
# Edit .env with your settings

# 5. Build Docker image
docker build -t cesium-route-recorder .

# 6. Start API server
cd server && node index.js

# 7. (Optional) Start Telegram bot
cd telegram-bot && node index.js
```

### Development Mode

```bash
# Start Vite dev server (web UI)
npm run dev

# Run in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

---

## 📖 Usage

### Web Interface

1. Open `http://localhost:5173`
2. Upload GPX/KML file
3. Animation plays in browser
4. (Optional) Trigger Docker recording

### API Endpoints

#### Render a Route

```bash
POST /render-route
Content-Type: multipart/form-data

# Fields:
- gpx: GPX/KML file
- userName: User name (optional)
- outputId: Custom output ID (optional)

# Response:
{
  "outputId": "render-1234567890-abc",
  "message": "Render started successfully"
}
```

#### Check Status

```bash
GET /status/:outputId

# Response:
{
  "status": "rendering",
  "stage": "execution",
  "progress": 65,
  "currentFrame": 450,
  "totalFrames": 700
}
```

#### Get Logs

```bash
# JSON format
GET /logs/:outputId

# Plain text
GET /logs/:outputId/text
```

#### Active Renders

```bash
GET /api/active-renders

# Response:
{
  "activeRenders": [
    {
      "outputId": "render-123",
      "stage": "execution",
      "progress": 45,
      "startTime": 1699564800000
    }
  ]
}
```

#### Cancel Render

```bash
DELETE /render/:outputId

# Response:
{
  "success": true,
  "message": "Render cancelled"
}
```

#### System Stats

```bash
GET /api/stats

# Response:
{
  "uptime": 3600,
  "memory": { "heapUsed": 150, "heapTotal": 512, "rss": 800 },
  "docker": { "containersRunning": 1 },
  "output": { "totalRenders": 42, "totalSizeMB": 1024 }
}
```

### Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/help` | Show available commands |
| `/language` | Switch between English/Russian |
| `/history` | View last 10 rendered routes |
| `/status` | Check current render status |
| `/logs <id>` | View render logs |
| `/cleanup` | Delete renders older than 7 days |
| **Send GPX** | Upload GPX/KML to start render |

---

## 🎥 Camera System

### Camera Strategies

```typescript
// 1. Follow (default)
// Camera follows behind entity with look-ahead
{
  strategy: 'follow',
  followDistance: 50,  // meters
  followHeight: 30,    // meters
  lookAheadDistance: 20
}

// 2. Cinematic
// Dynamic angles based on route characteristics
{
  strategy: 'cinematic',
  followDistance: 80,
  followHeight: 50,
  lookAheadDistance: 40
}

// 3. Bird's Eye
// High-altitude overview
{
  strategy: 'birds-eye',
  followHeight: 500,
  lookAheadDistance: 100
}

// 4. Static
// Fixed camera position
{
  strategy: 'static',
  followDistance: 100,
  followHeight: 200
}
```

### Route Patterns

The system detects 7 route patterns and adjusts camera accordingly:

| Pattern | Detection Criteria | Camera Adjustment |
|---------|-------------------|-------------------|
| `technical_climb` | >12% grade, >600m gain | 1.5x distance, 1.3x height, -15° pitch |
| `scenic_overlook` | >2000m elevation, <5km distance | 2.0x distance, 1.5x height, -10° pitch |
| `alpine_ridge` | >2400m elevation, moderate distance | 1.8x distance, 1.4x height, -5° pitch |
| `valley_traverse` | <800m elevation, >10km distance | 1.2x distance, 1.1x height |
| `switchback_section` | >8 turns, >15% grade | 1.3x distance, 1.4x height, -20° pitch |
| `flat_approach` | <100m gain, <1000m elevation | 0.9x distance, 0.9x height |
| `unknown` | Doesn't match patterns | Default settings |

### Using Advanced Camera

```tsx
// In CesiumViewer.tsx
useCesiumCamera({
  viewer: viewerRef.current,
  targetEntity: entity,
  enableAdvancedCamera: true,  // Enable pattern-aware camera
  cameraStrategy: 'cinematic',
  routePattern: 'alpine_ridge',
  positions: routePositions,
  times: routeTimes
});
```

---

## 🧪 Testing

### Run Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Coverage

- **45 test cases** across 3 service test files
- **Coverage targets**: >80% statements, branches, functions, lines

### Test Suites

1. **routeAnalyzerService** (11 tests)
   - Pattern detection for all 7 types
   - Animation speed calculation
   - Analysis validation
   - Overlay generation

2. **renderOrchestratorService** (14 tests)
   - 5-stage pipeline execution
   - Progress tracking 0-100%
   - Active render management
   - Stage transitions
   - Error handling
   - Render cancellation

3. **memoryMonitorService** (20 tests)
   - Monitor lifecycle
   - Memory measurement tracking
   - Threshold detection
   - Trend analysis
   - Global statistics

---

## 🔧 Configuration

### Environment Variables

```bash
# Server
PORT=3000
API_SERVER=http://localhost:3000
PUBLIC_URL=http://your-domain.com:3000

# Docker
DOCKER_IMAGE=cesium-route-recorder
OUTPUT_DIR=/path/to/output

# Telegram Bot
BOT_TOKEN=your_telegram_bot_token

# Recording
HEADLESS=1                    # Use headless defaults (30fps, 720p)
RECORD_FPS=60                 # Override FPS
RECORD_WIDTH=1920             # Override width
RECORD_HEIGHT=1080            # Override height
ANIMATION_SPEED=2             # Route playback speed multiplier
```

### Render Settings

```javascript
// config/rendering.js
{
  defaultWidth: 1920,
  defaultHeight: 1080,
  defaultFps: 60,
  videoFormat: 'mp4',
  videoCodec: 'libx264',
  maxVideoDuration: 60  // minutes
}
```

### Animation Speed

Speed is calculated adaptively:

```javascript
speed = Math.ceil(routeDurationMinutes / (maxVideoDuration - bufferMinutes))
speed = Math.max(2, Math.min(speed, 10))  // Clamped 2-10x
```

Examples:
- 2 hour route → 2x speed → 60 min video
- 10 hour route → 10x speed → 60 min video

---

## 🐳 Docker

### Build Image

```bash
docker build -t cesium-route-recorder .
```

### Run Container

```bash
docker run --rm \
  -e HEADLESS=1 \
  -e GPX_FILENAME=route.gpx \
  -e ANIMATION_SPEED=5 \
  -v $(pwd)/gpx:/gpx:ro \
  -v $(pwd)/output:/output \
  cesium-route-recorder
```

### Docker Compose

```yaml
version: '3.8'
services:
  recorder:
    build: .
    environment:
      - HEADLESS=1
    volumes:
      - ./gpx:/gpx:ro
      - ./output:/output
```

---

## 📊 Monitoring & Debugging

### Memory Monitoring

```javascript
const { createMonitor } = require('./server/services/memoryMonitorService');

const monitor = createMonitor('my-render', {
  warningThreshold: 1500,  // MB
  criticalThreshold: 2000,
  onWarning: (data) => console.warn('Memory warning:', data),
  onCritical: (data) => console.error('Memory critical:', data)
});

// Later...
const stats = stopMonitor('my-render');
console.log('Peak memory:', stats.peakMemory);
```

### Logs

Server logs are written to:
- **Console**: Structured JSON logs
- **Files**: `output/<outputId>/render.log`

Access logs via API:
```bash
curl http://localhost:3000/logs/<outputId>/text
```

---

## 🛠️ Development

### Project Structure

```
cesium-vite-react/
├── server/                   # API server
│   ├── index.js             # Main server file
│   └── services/            # Business logic services
│       ├── __tests__/       # Unit tests
│       ├── gpxService.js
│       ├── routeAnalyzerService.js
│       ├── renderOrchestratorService.js
│       └── ...
├── telegram-bot/            # Telegram bot
│   ├── index.js
│   └── services/
│       ├── apiService.js
│       ├── stateService.js
│       └── botHandlersService.js
├── src/                     # React frontend
│   ├── services/
│   │   └── cesiumCameraService.ts
│   ├── hooks/
│   │   ├── useCesiumAnimation.ts
│   │   └── useCesiumCamera.ts
│   └── components/
├── docker/                  # Docker configuration
├── config/                  # Application config
├── public/                  # Static assets
└── scripts/                 # Build scripts
```

### Adding a New Service

1. Create service file: `server/services/myService.js`
2. Implement singleton pattern:
   ```javascript
   class MyService {
     constructor() {
       if (MyService.instance) {
         return MyService.instance;
       }
       MyService.instance = this;
     }
     
     myMethod() {
       // Logic here
     }
   }
   
   module.exports = new MyService();
   ```

3. Add tests: `server/services/__tests__/myService.test.js`
4. Import in orchestrator or endpoint

### Code Style

- **ES6+** for server code
- **TypeScript** for client code
- **Prettier** for formatting
- **ESLint** for linting
- **Jest** for testing

---

## 🚢 Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed production deployment instructions.

### Quick Deploy (Ubuntu/Debian)

```bash
# 1. Install Node.js and Docker
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs docker.io

# 2. Clone and install
git clone <repo-url>
cd cesium-route-renderer
npm install
cd telegram-bot && npm install && cd ..

# 3. Build Docker image
docker build -t cesium-route-recorder .

# 4. Start with PM2
npm install -g pm2
pm2 start server/index.js --name api-server
pm2 start telegram-bot/index.js --name telegram-bot
pm2 save
pm2 startup
```

---

## 📝 API Documentation

Full API documentation available at:
- **Swagger UI**: `http://localhost:3000/api-docs` (if enabled)
- **Postman Collection**: See [docs/postman-collection.json](docs/postman-collection.json)

### Endpoint Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/render-route` | POST | Start new render |
| `/status/:id` | GET | Get render status |
| `/logs/:id` | GET | Get logs (JSON) |
| `/logs/:id/text` | GET | Get logs (text) |
| `/api/active-renders` | GET | List active renders |
| `/render/:id` | DELETE | Cancel render |
| `/api/stats` | GET | System statistics |
| `/api/settings` | GET/PUT | Configuration |
| `/api/camera-settings` | GET/PUT | Camera settings |
| `/cleanup` | GET | Cleanup old renders |
| `/health` | GET | Health check |

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Development Guidelines

- Write tests for new features
- Update documentation
- Follow existing code style
- Keep commits atomic and descriptive

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **CesiumJS**: 3D geospatial visualization
- **Vite**: Fast build tool
- **React**: UI framework
- **Puppeteer**: Headless browser automation
- **FFmpeg**: Video encoding
- **node-telegram-bot-api**: Telegram integration

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/cesium-route-renderer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/cesium-route-renderer/discussions)
- **Email**: support@your-domain.com

---

## 🗺️ Roadmap

- [ ] Web-based camera control interface
- [ ] Real-time collaborative route planning
- [ ] Additional camera strategies (drone, FPV, orbit)
- [ ] Support for multiple route formats (TCX, FIT)
- [ ] Cloud deployment templates (AWS, GCP, Azure)
- [ ] Performance benchmarking suite
- [ ] Camera movement presets library
- [ ] Route difficulty calculator
- [ ] Social sharing integration

---

**Built with ❤️ for outdoor enthusiasts and developers**
