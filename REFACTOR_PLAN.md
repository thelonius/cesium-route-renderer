# Refactoring Plan - Cesium Route Renderer

## Overview
Systematic refactoring to support upcoming camera movement features with new heuristics for speed, height, and video parameters. Breaking changes into atomic commits for safe deployment.

## Current Architecture Issues
- Massive route handlers (400+ lines)
- Duplicate code (GPX parsing, progress monitoring)
- Hardcoded values scattered throughout
- No separation of concerns
- Missing abstraction for camera/rendering logic

## Future Requirements
- **Camera movement system**: Dynamic speed, height, angle based on terrain/route type
- **Terrain analysis**: Detect elevation changes, route complexity
- **Adaptive rendering**: Adjust quality/fps based on route characteristics
- **Heuristic engine**: Route classification (hiking, cycling, driving, etc.)

---

## Phase 1: Foundation & Configuration (Commits 1-3)

### Commit 1: Extract constants and configuration
**Goal**: Centralize all magic numbers and hardcoded values
**Files to create**:
- `config/constants.js` - All magic numbers
- `config/docker.js` - Docker-specific config
- `config/rendering.js` - Video/rendering settings

**Changes**:
```javascript
// config/constants.js
module.exports = {
  DOCKER: {
    USER_ID: process.env.DOCKER_USER_ID || '1001',
    GROUP_ID: process.env.DOCKER_GROUP_ID || '1002',
    SHM_SIZE: '2g',
    DEFAULT_IMAGE: 'cesium-route-recorder'
  },
  MEMORY: {
    CHECK_INTERVAL_MS: 30000,
    WARNING_THRESHOLD_MB: 1500,
    CRITICAL_THRESHOLD_MB: 2000
  },
  RENDER: {
    VIDEO_BUFFER_SECONDS: 19,
    PROGRESS_CHECK_INTERVAL_MS: 20000,
    TIMEOUT_MS: 3600000,
    DEFAULT_FPS: 30,
    MAX_VIDEO_MINUTES: 10
  },
  TELEGRAM: {
    MAX_FILE_SIZE_MB: 50,
    LOG_TRUNCATE_LENGTH: 4000,
    HISTORY_LIMIT: 10,
    PROGRESS_UPDATE_INTERVAL_MS: 20000
  },
  ANIMATION: {
    DEFAULT_SPEED: 2,
    MIN_SPEED: 1,
    MAX_SPEED: 100,
    ADAPTIVE_BUFFER_MINUTES: 0.5
  },
  GEO: {
    EARTH_RADIUS_METERS: 6371000,
    DEFAULT_WALKING_SPEED_KMH: 5
  }
};
```

**Impact**: Prepares for camera heuristics that will use these as base values
**Test**: All existing functionality works unchanged

---

### Commit 2: Settings service singleton
**Goal**: Replace scattered settings loading with centralized service
**Files to create**:
- `server/services/settingsService.js`

**Changes**:
```javascript
// server/services/settingsService.js
class SettingsService {
  constructor() {
    this.settings = null;
    this.settingsPath = path.join(__dirname, '../settings.json');
  }

  load() {
    // Load with defaults, cache in memory
  }

  get(path) {
    // Get nested setting: settingsService.get('animation.defaultSpeed')
  }

  update(path, value) {
    // Update and persist
  }

  getAnimationSettings() { }
  getRecordingSettings() { }
  getCameraSettings() { } // NEW - for future camera logic
}

module.exports = new SettingsService(); // Singleton
```

**Impact**: Single source of truth for settings, easy to extend for camera params
**Test**: Settings API endpoints work, renders use correct settings

---

### Commit 3: Utility functions extraction
**Goal**: Extract reusable math and formatting functions
**Files to create**:
- `utils/geoMath.js` - Distance, elevation calculations
- `utils/durationFormatter.js` - Time formatting
- `utils/logParser.js` - Docker log parsing

**Changes**:
```javascript
// utils/geoMath.js
function haversineDistance(lat1, lon1, lat2, lon2) { }
function calculateTotalDistance(points) { }
function calculateElevationGain(points) { } // NEW - for camera height logic
function estimateRouteType(distance, duration, elevationGain) { } // NEW - heuristic
```

**Impact**: Foundation for terrain analysis needed by camera system
**Test**: Distance calculations match existing behavior

---

## Phase 2: Service Layer - GPX & Route Analysis (Commits 4-6)

### Commit 4: GPX/KML parser service
**Goal**: Extract all file parsing logic
**Files to create**:
- `server/services/gpxService.js`

**Changes**:
```javascript
// server/services/gpxService.js
class GpxService {
  parseFile(filePath) {
    // Returns structured data
    return {
      points: [...],
      timestamps: [...],
      elevations: [...], // NEW - for camera height
      metadata: { }
    };
  }

  extractDuration(content) { }
  detectFileType(filename) { }

  // NEW - for camera heuristics
  analyzeRoute(parsedData) {
    return {
      totalDistance,
      duration,
      elevationProfile,
      avgSpeed,
      maxSpeed,
      terrain: 'flat|hilly|mountainous',
      complexity: 'simple|moderate|complex'
    };
  }
}
```

**Impact**: Provides rich route data for camera movement decisions
**Test**: GPX parsing produces same results, adds elevation data

---

### Commit 5: Animation speed calculator service
**Goal**: Extract adaptive speed logic, prepare for multi-factor heuristics
**Files to create**:
- `server/services/animationSpeedService.js`

**Changes**:
```javascript
// server/services/animationSpeedService.js
class AnimationSpeedService {
  calculateSpeed(routeData, options = {}) {
    const { duration, distance, elevation, terrain } = routeData;

    // Current logic: time-based
    let speed = this.calculateTimeBasedSpeed(duration);

    // NEW - Future heuristics hooks
    if (options.considerTerrain) {
      speed = this.adjustForTerrain(speed, terrain, elevation);
    }

    if (options.considerComplexity) {
      speed = this.adjustForComplexity(speed, routeData.complexity);
    }

    return speed;
  }

  // Placeholder for future camera speed sync
  getCameraSpeedMultiplier(animationSpeed, terrain) {
    // Camera might move slower/faster than animation
    return 1.0;
  }
}
```

**Impact**: Easy to add terrain-aware speed adjustments for camera
**Test**: Speed calculations match current behavior

---

### Commit 6: Route analyzer service (NEW)
**Goal**: Create service for route classification and heuristics
**Files to create**:
- `server/services/routeAnalyzerService.js`

**Changes**:
```javascript
// server/services/routeAnalyzerService.js
class RouteAnalyzerService {
  constructor() {
    this.gpxService = require('./gpxService');
    this.geoMath = require('../utils/geoMath');
  }

  analyze(gpxPath) {
    const parsed = this.gpxService.parseFile(gpxPath);

    return {
      classification: this.classifyRoute(parsed),
      cameraProfile: this.generateCameraProfile(parsed),
      renderingHints: this.getRenderingHints(parsed)
    };
  }

  classifyRoute(data) {
    // hiking, cycling, driving, flying, mixed
    const avgSpeed = data.distance / data.duration;
    if (avgSpeed < 6) return 'hiking';
    if (avgSpeed < 25) return 'cycling';
    return 'driving';
  }

  generateCameraProfile(data) {
    // NEW - Camera behavior based on route type
    return {
      defaultHeight: this.calculateOptimalHeight(data),
      followDistance: this.calculateFollowDistance(data),
      smoothingFactor: this.calculateSmoothing(data),
      tiltAngle: this.calculateTilt(data)
    };
  }

  getRenderingHints(data) {
    // Suggest FPS, quality based on route
    return {
      suggestedFps: data.complexity === 'complex' ? 60 : 30,
      suggestedQuality: data.duration > 60 ? 'medium' : 'high'
    };
  }
}
```

**Impact**: Core service for camera movement system
**Test**: Analyze test routes, verify classifications

---

## Phase 3: Service Layer - Docker & Rendering (Commits 7-9)

### Commit 7: Docker service
**Goal**: Encapsulate all Docker operations
**Files to create**:
- `server/services/dockerService.js`

**Changes**:
```javascript
// server/services/dockerService.js
class DockerService {
  constructor() {
    this.config = require('../config/constants').DOCKER;
  }

  buildRunArgs(options) {
    const { gpxPath, outputDir, settings, cameraProfile } = options;

    const args = [
      'run', '--rm',
      '--user', `${this.config.USER_ID}:${this.config.GROUP_ID}`,
      '--shm-size', this.config.SHM_SIZE,
      // ... existing args
    ];

    // NEW - Pass camera settings to container
    if (cameraProfile) {
      args.push('-e', `CAMERA_HEIGHT=${cameraProfile.defaultHeight}`);
      args.push('-e', `CAMERA_TILT=${cameraProfile.tiltAngle}`);
      args.push('-e', `CAMERA_SMOOTHING=${cameraProfile.smoothingFactor}`);
    }

    return args;
  }

  spawn(args) {
    return spawn('docker', args);
  }

  monitorProcess(dockerProcess, callbacks) {
    // Handle stdout, stderr, error, close
  }
}
```

**Impact**: Easy to add camera-related env vars
**Test**: Docker containers run with same behavior

---

### Commit 8: Memory monitor service
**Goal**: Extract memory monitoring logic
**Files to create**:
- `server/services/memoryMonitorService.js`

**Changes**:
```javascript
// server/services/memoryMonitorService.js
class MemoryMonitorService {
  startMonitoring(outputDir, options = {}) {
    const interval = setInterval(() => {
      this.logMemoryUsage(outputDir);
    }, CONSTANTS.MEMORY.CHECK_INTERVAL_MS);

    return {
      stop: () => clearInterval(interval),
      getStats: () => this.getCurrentStats()
    };
  }

  logMemoryUsage(outputDir) { }
  getCurrentStats() { }
  isUnderPressure() { } // NEW - for adaptive quality
}
```

**Impact**: Can adjust camera complexity if memory pressure detected
**Test**: Memory logs appear as before

---

### Commit 9: Render orchestrator service
**Goal**: Coordinate all render operations
**Files to create**:
- `server/services/renderService.js`

**Changes**:
```javascript
// server/services/renderService.js
class RenderService {
  constructor() {
    this.gpxService = require('./gpxService');
    this.routeAnalyzer = require('./routeAnalyzerService');
    this.animationSpeedService = require('./animationSpeedService');
    this.dockerService = require('./dockerService');
    this.memoryMonitor = require('./memoryMonitorService');
  }

  async render(gpxPath, outputDir, options = {}) {
    // 1. Analyze route
    const analysis = this.routeAnalyzer.analyze(gpxPath);

    // 2. Calculate animation speed
    const speed = this.animationSpeedService.calculateSpeed(
      analysis,
      { considerTerrain: options.adaptiveCamera || false }
    );

    // 3. Build Docker config
    const dockerArgs = this.dockerService.buildRunArgs({
      gpxPath,
      outputDir,
      settings: this.getSettings(),
      cameraProfile: analysis.cameraProfile // NEW
    });

    // 4. Start monitoring
    const monitor = this.memoryMonitor.startMonitoring(outputDir);

    // 5. Run Docker
    const process = this.dockerService.spawn(dockerArgs);

    // 6. Monitor and return
    return this.monitorRenderProcess(process, monitor);
  }

  monitorRenderProcess(dockerProcess, memoryMonitor) {
    return new Promise((resolve, reject) => {
      // Handle all process events
    });
  }
}
```

**Impact**: Single entry point for rendering, easy to extend
**Test**: Renders work end-to-end

---

## Phase 4: Refactor Server Endpoints (Commits 10-11)

### Commit 10: Slim down /render-route endpoint
**Goal**: Use new services, reduce handler to ~50 lines
**Files to modify**:
- `server/index.js`

**Changes**:
```javascript
app.post('/render-route', upload.single('gpx'), async (req, res) => {
  const { file, body } = req;
  const outputId = body.outputId || `route_${Date.now()}`;

  // Validate
  if (!file) return res.status(400).json({ error: 'No file' });

  // Setup
  const outputDir = path.join(__dirname, '../output', outputId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Copy file
  const gpxPath = fileService.saveUploadedFile(file, outputDir);

  try {
    // Render using service
    const result = await renderService.render(gpxPath, outputDir, {
      userName: body.userName || 'Hiker',
      adaptiveCamera: body.adaptiveCamera !== false // NEW - opt-in
    });

    res.json({
      success: true,
      ...result,
      cameraProfile: result.cameraProfile // NEW - return camera settings used
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Impact**: Clean, maintainable endpoint ready for camera params
**Test**: All render requests work

---

### Commit 11: Create camera settings API endpoints (NEW)
**Goal**: API for camera configuration and testing
**Files to modify**:
- `server/index.js`

**Changes**:
```javascript
// Get camera profile for a route (preview before render)
app.post('/api/camera-profile', upload.single('gpx'), async (req, res) => {
  const analysis = routeAnalyzer.analyze(req.file.path);
  res.json({
    profile: analysis.cameraProfile,
    classification: analysis.classification,
    hints: analysis.renderingHints
  });
});

// Update camera settings
app.put('/api/camera-settings', (req, res) => {
  settingsService.update('camera', req.body);
  res.json({ success: true });
});

// Get camera presets
app.get('/api/camera-presets', (req, res) => {
  res.json({
    hiking: { height: 100, tilt: 45, smoothing: 0.8 },
    cycling: { height: 150, tilt: 35, smoothing: 0.6 },
    driving: { height: 200, tilt: 25, smoothing: 0.4 }
  });
});
```

**Impact**: Frontend can preview/customize camera behavior
**Test**: New endpoints return expected data

---

## Phase 5: Refactor Telegram Bot (Commits 12-14)

### Commit 12: Extract bot handlers
**Goal**: Break massive document handler into modules
**Files to create**:
- `telegram-bot/handlers/documentHandler.js`
- `telegram-bot/handlers/commandHandlers.js`
- `telegram-bot/handlers/callbackHandlers.js`

**Changes**: Move command logic to separate handlers
**Impact**: Easier to add camera settings UI to bot
**Test**: All bot commands work

---

### Commit 13: Create API client wrapper
**Goal**: Centralize all API calls
**Files to create**:
- `telegram-bot/services/apiClient.js`

**Changes**:
```javascript
class RenderApiClient {
  async submitRender(formData, options = {}) { }
  async getCameraProfile(gpxPath) { } // NEW
  async getRenderStatus(outputId) { }
  async getLogs(outputId) { }
}
```

**Impact**: Easy to add camera profile requests
**Test**: Bot still communicates with API

---

### Commit 14: Add camera settings to bot (NEW)
**Goal**: Let users preview/customize camera behavior
**Files to modify**:
- `telegram-bot/index.js`

**Changes**:
```javascript
// Before rendering, analyze and show camera settings
bot.on('document', async (msg) => {
  // ... existing code ...

  // NEW - Get camera profile
  const profile = await apiClient.getCameraProfile(tempPath);

  await bot.sendMessage(chatId,
    `🎥 Camera Settings:\n` +
    `Height: ${profile.defaultHeight}m\n` +
    `Tilt: ${profile.tiltAngle}°\n` +
    `Type: ${profile.routeType}\n\n` +
    `Adjust settings?`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Use defaults', callback_data: 'camera_default' }],
          [{ text: '⚙️ Customize', callback_data: 'camera_custom' }]
        ]
      }
    }
  );
});
```

**Impact**: User can see/control camera behavior
**Test**: Bot shows camera preview before render

---

## Phase 6: Docker Container Updates (Commits 15-17)

### Commit 15: Update Docker scripts to receive camera params
**Goal**: Make recording scripts camera-aware
**Files to modify**:
- `docker/record-canvas.js`
- `docker/record-ffmpeg.js`

**Changes**:
```javascript
// docker/record-canvas.js
const CAMERA_HEIGHT = parseFloat(process.env.CAMERA_HEIGHT || '150');
const CAMERA_TILT = parseFloat(process.env.CAMERA_TILT || '45');
const CAMERA_SMOOTHING = parseFloat(process.env.CAMERA_SMOOTHING || '0.7');

// Pass to browser context
await page.evaluate((config) => {
  window.CAMERA_CONFIG = config;
}, { CAMERA_HEIGHT, CAMERA_TILT, CAMERA_SMOOTHING });
```

**Impact**: Docker containers can use camera settings
**Test**: Containers receive and log camera params

---

### Commit 16: Update Cesium app with camera controls (NEW)
**Goal**: Implement actual camera movement logic
**Files to modify**:
- `src/CesiumViewer.tsx`

**Changes**:
```javascript
// NEW - Camera controller
class CameraController {
  constructor(viewer, config) {
    this.viewer = viewer;
    this.config = config;
  }

  updateCamera(position, heading, terrain) {
    const height = this.calculateHeight(terrain);
    const tilt = this.calculateTilt(terrain);

    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        position.lon,
        position.lat,
        height
      ),
      orientation: {
        heading: heading,
        pitch: Cesium.Math.toRadians(tilt - 90),
        roll: 0.0
      }
    });
  }

  calculateHeight(terrain) {
    const base = this.config.defaultHeight;
    const elevation = terrain.elevation || 0;
    return base + elevation; // Follow terrain
  }

  calculateTilt(terrain) {
    // Steeper tilt for flat terrain, shallower for mountains
    const slope = terrain.slope || 0;
    return this.config.tiltAngle - (slope * 0.5);
  }
}
```

**Impact**: Camera actually responds to route characteristics
**Test**: Videos show different camera behavior per route type

---

### Commit 17: Add camera smoothing and interpolation (NEW)
**Goal**: Smooth camera movements between points
**Files to modify**:
- `src/CesiumViewer.tsx`

**Changes**:
```javascript
// Interpolate camera positions for smooth movement
function interpolateCamera(start, end, t, smoothing) {
  // Use bezier or catmull-rom spline
  // Factor in smoothing setting
}
```

**Impact**: Professional-looking camera movements
**Test**: Camera transitions are smooth

---

## Phase 7: Testing & Documentation (Commits 18-19)

### Commit 18: Add tests for new services
**Files to create**:
- `tests/services/routeAnalyzer.test.js`
- `tests/services/animationSpeed.test.js`
- `tests/utils/geoMath.test.js`

**Impact**: Ensure heuristics work correctly
**Test**: npm test passes

---

### Commit 19: Update documentation
**Files to update**:
- `README.md`
- `docs/CAMERA_SYSTEM.md` (NEW)
- `docs/API.md`

**Changes**: Document camera features, heuristics, API endpoints
**Impact**: Users understand new capabilities

---

## Commit Summary (19 Commits Total)

| # | Title | Type | Risk | Dependencies |
|---|-------|------|------|--------------|
| 1 | Extract constants and configuration | Refactor | Low | None |
| 2 | Settings service singleton | Refactor | Low | #1 |
| 3 | Utility functions extraction | Refactor | Low | #1 |
| 4 | GPX/KML parser service | Refactor | Medium | #2, #3 |
| 5 | Animation speed calculator service | Refactor | Medium | #2, #3, #4 |
| 6 | Route analyzer service | **Feature** | Medium | #3, #4 |
| 7 | Docker service | Refactor | Medium | #1, #2 |
| 8 | Memory monitor service | Refactor | Low | #1 |
| 9 | Render orchestrator service | Refactor | High | #4-#8 |
| 10 | Slim down /render-route endpoint | Refactor | High | #9 |
| 11 | Camera settings API endpoints | **Feature** | Low | #6, #9 |
| 12 | Extract bot handlers | Refactor | Medium | None |
| 13 | Create API client wrapper | Refactor | Low | None |
| 14 | Add camera settings to bot | **Feature** | Low | #11, #13 |
| 15 | Update Docker scripts for camera params | **Feature** | Medium | #7 |
| 16 | Update Cesium app with camera controls | **Feature** | High | #15 |
| 17 | Add camera smoothing | **Feature** | Medium | #16 |
| 18 | Add tests for new services | Test | Low | #1-#9 |
| 19 | Update documentation | Docs | Low | All |

---

## Migration Strategy

### Safe Deployment Pattern
Each commit follows:
1. Create new service/module
2. Add tests
3. Use in parallel with old code (feature flag if needed)
4. Verify in staging
5. Switch to new code
6. Remove old code in next commit

### Rollback Plan
- Each commit is independently deployable
- Old code path remains until verified
- Feature flags for camera features: `USE_CAMERA_HEURISTICS=false`

### Testing Checklist per Commit
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual test on dev server
- [ ] Memory usage unchanged
- [ ] Render time unchanged (until camera features)
- [ ] Existing videos still render correctly

---

## Timeline Estimate

- **Phase 1-2** (Foundation + Route Analysis): 2-3 days
- **Phase 3-4** (Docker + Server): 2-3 days
- **Phase 5** (Bot): 1-2 days
- **Phase 6** (Camera Implementation): 3-4 days
- **Phase 7** (Testing + Docs): 1-2 days

**Total**: ~10-15 days for complete refactor + camera system

---

## Success Criteria

### Refactoring Goals
- ✅ No endpoint >100 lines
- ✅ All magic numbers in config
- ✅ Services <200 lines each
- ✅ No duplicate logic
- ✅ 80%+ test coverage

### Camera Feature Goals
- ✅ Route classification accuracy >90%
- ✅ Camera profiles generate for all route types
- ✅ User can preview/customize camera settings
- ✅ Videos show appropriate camera movement per route
- ✅ Performance impact <10%

---

## Next Steps

1. **Review & approve this plan**
2. **Set up feature branch**: `feature/refactor-camera-system`
3. **Start Phase 1, Commit 1**: Extract constants
4. **Deploy each commit to staging for validation**
5. **Merge to main after Phase 2** (foundation stable)
6. **Continue through phases with user feedback**

---

## Notes

- Camera heuristics can start simple (route type only) and evolve
- Consider A/B testing different camera profiles
- Collect user feedback on camera behavior
- May need ML model for advanced route classification (future)
- Keep old rendering mode as fallback option
