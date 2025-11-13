# Animation Speed & Render Optimization Guide

## How Clock Multiplier is Determined

### Current Configuration

**Default Speed**: `50x` (defined in `useCesiumAnimation.ts` line 24)
```typescript
animationSpeed = 50 // Default to 50x for better FPS
```

**Override Sources** (in priority order):
1. URL parameter: `?animationSpeed=90`
2. Environment variable: `ANIMATION_SPEED=90`
3. Default: `50x`

### Clock Multiplier Flow

```
1. URL Parameter Check (CesiumViewer.tsx:62-65)
   └─> Parse animationSpeed from URL query string

2. Pass to Animation Hook (CesiumViewer.tsx:74)
   └─> useCesiumAnimation({ animationSpeed })

3. Initial Setup (useCesiumAnimation.ts:60-64)
   ├─> Set clock range: CLAMPED (no looping)
   ├─> Set clock step: SYSTEM_CLOCK_MULTIPLIER
   └─> Initial multiplier: 0 (paused)

4. Opening Animation Sequence (5 seconds)
   ├─> Phase 1: Globe fade-in (1s wait)
   ├─> Phase 2: Camera movement (5s)
   └─> Phase 3: Speed ease-in (3s)
       └─> Gradually ramps from 0x to animationSpeed (cubic easing)

5. Main Route Playback
   └─> multiplier = animationSpeed (constant)

6. Route End
   └─> multiplier = 0 (stops)
```

---

## Render Time vs Frame Drops

### The Trade-off

**Clock Multiplier** determines:
- How fast animation time advances
- Recording duration = (Route Duration in seconds) / multiplier
- Example: 10-minute route at 50x = 12 seconds recording

**Frame Rate** (90 FPS target):
- GPU must render a frame every ~11ms
- Higher multiplier = more distance covered per frame
- More distance = more terrain tiles needed = more GPU work

### Frame Drop Causes

1. **Terrain Loading**
   - `maximumScreenSpaceError: 1.5` = high detail
   - More tiles need to load as camera moves
   - GPU can't keep up with 90 FPS

2. **Graphics Features**
   - Shadows: expensive ray calculations
   - HDR: additional post-processing
   - Lighting: per-pixel calculations
   - High terrain detail: more vertices to process

3. **Speed Too High**
   - Camera moves too fast → terrain tiles can't load in time
   - Results in "pop-in" or frame drops while loading

---

## Optimization Strategies

### 1. Dynamic Speed Adjustment (Recommended)

**Current**: Fixed 50x multiplier
**Proposed**: Adaptive multiplier based on frame time

```typescript
// Monitor frame time and adjust speed dynamically
let lastFrameTime = performance.now();
let frameTimeHistory: number[] = [];

viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  const frameTime = now - lastFrameTime;
  lastFrameTime = now;

  frameTimeHistory.push(frameTime);
  if (frameTimeHistory.length > 30) frameTimeHistory.shift(); // Keep 30 samples

  const avgFrameTime = frameTimeHistory.reduce((a, b) => a + b) / frameTimeHistory.length;
  const targetFrameTime = 1000 / 90; // 11.1ms for 90 FPS

  // If average frame time exceeds target by 20%, reduce speed
  if (avgFrameTime > targetFrameTime * 1.2) {
    viewer.clock.multiplier = Math.max(25, viewer.clock.multiplier * 0.95);
    console.log('Reducing speed due to frame drops:', viewer.clock.multiplier);
  }
  // If performing well, gradually increase back
  else if (avgFrameTime < targetFrameTime * 0.9 && viewer.clock.multiplier < animationSpeed) {
    viewer.clock.multiplier = Math.min(animationSpeed, viewer.clock.multiplier * 1.05);
  }
});
```

### 2. Tiered Speed Profiles

**Based on Route Characteristics**:

```typescript
function calculateOptimalSpeed(route: TrackPoint[]): number {
  // Analyze route terrain variation
  const elevationChanges = calculateElevationVariation(route);
  const turnDensity = calculateTurnDensity(route);

  if (elevationChanges > 1000 || turnDensity > 0.3) {
    return 30; // Complex terrain - slower speed
  } else if (elevationChanges > 500) {
    return 50; // Moderate terrain - medium speed
  } else {
    return 75; // Flat/simple terrain - higher speed
  }
}
```

### 3. Quality vs Speed Settings

**Preset Profiles**:

| Profile | Speed | FPS | Quality | Use Case |
|---------|-------|-----|---------|----------|
| **Ultra** | 30x | 90 | Max | Show reels, demos |
| **High** | 50x | 90 | High | Default |
| **Balanced** | 75x | 60 | Medium | Fast processing |
| **Fast** | 100x | 30 | Low | Quick previews |

### 4. Terrain Pre-loading

```typescript
// Preload terrain tiles along route before starting
async function preloadTerrainForRoute(route: TrackPoint[]) {
  const tilesToPreload = calculateRequiredTiles(route);

  for (const tile of tilesToPreload) {
    await viewer.scene.globe.terrainProvider.requestTileGeometry(
      tile.x, tile.y, tile.level
    );
  }

  console.log('Terrain preloaded');
}
```

### 5. Render Budget Management

**Current Settings** (useViewerInit.ts):
```typescript
requestRenderMode: !isDocker,           // Continuous in Docker
maximumRenderTimeChange: isDocker ? 0 : Infinity,
maximumScreenSpaceError: 1.5,           // High detail
tileCacheSize: 500,                     // Large cache
```

**For Zero Frame Drops**:
```typescript
// Increase screen space error = lower detail = faster rendering
maximumScreenSpaceError: 3.0,  // Was 1.5

// Reduce tile cache if memory limited
tileCacheSize: 300,  // Was 500

// Disable expensive features during fast playback
if (animationSpeed > 60) {
  viewer.scene.globe.enableLighting = false;
  viewer.scene.shadows = false;
  viewer.scene.postProcessStages.fxaa.enabled = false;
}
```

---

## Recommended Configuration

### For 90 FPS Zero Frame Drops

**Option A: Reduce Speed**
```typescript
animationSpeed = 30  // Slower but guaranteed smooth
```

**Option B: Reduce Quality**
```typescript
animationSpeed = 50  // Current speed
maximumScreenSpaceError = 2.5  // Slightly lower detail
shadows = false  // Disable shadows during fast movement
```

**Option C: Adaptive (Best)**
```typescript
animationSpeed = 50  // Start at default
// Monitor and adjust dynamically (see Strategy 1 above)
// Enable/disable features based on performance
```

### For Minimum Recording Time

**Current**: 10-min route at 50x = 12 seconds recording

**Aggressive**:
```typescript
animationSpeed = 100  // Double speed
FPS = 60  // Reduce from 90
maximumScreenSpaceError = 4  // Lower quality
shadows = false
lighting = false
```
Result: 10-min route = 6 seconds recording

**Trade-off Matrix**:
```
Speed 30x + 90 FPS + High Quality = Longest recording, best quality
Speed 50x + 90 FPS + Med Quality = Balanced (CURRENT)
Speed 75x + 60 FPS + Med Quality = Faster, some quality loss
Speed 100x + 30 FPS + Low Quality = Fastest, noticeable quality loss
```

---

## Implementation Priority

### Phase 1: Monitoring (Add First)
```typescript
// Add FPS counter and frame time monitoring
// Log dropped frames and average frame times
// Determine actual performance on GPU server
```

### Phase 2: Adaptive Speed (If frame drops detected)
```typescript
// Implement dynamic multiplier adjustment
// Test with various routes
```

### Phase 3: Quality Profiles (User configurable)
```typescript
// Add URL parameter: ?quality=ultra|high|balanced|fast
// Adjust speed, FPS, and graphics settings accordingly
```

### Phase 4: Intelligent Defaults
```typescript
// Analyze route complexity before starting
// Auto-select optimal speed/quality profile
```

---

## Testing Strategy

1. **Baseline Test**
   - Record 5-minute route at current settings (50x, 90 FPS)
   - Monitor: actual FPS, frame drops, tile loading delays
   - Measure: recording duration, file size, subjective quality

2. **Speed Sweep**
   - Test same route at: 30x, 50x, 75x, 100x
   - Keep FPS at 90, quality high
   - Identify highest speed with zero drops

3. **Quality Sweep**
   - Test at fixed 50x speed
   - Vary: shadows on/off, SSE 1.5/2.5/4.0, lighting on/off
   - Find minimum quality with acceptable results

4. **Real-world Routes**
   - Test with flat (easy), hilly (medium), mountain (hard) routes
   - Determine optimal speeds for each terrain type

---

## Current Bottlenecks

Based on configuration analysis:

1. **High Graphics Load**
   - Shadows + HDR + Lighting + FXAA all enabled
   - Each adds 20-30% GPU overhead

2. **High Terrain Detail**
   - `maximumScreenSpaceError: 1.5` = very high quality
   - Generates 2-4x more triangles than default (2.0)

3. **90 FPS Target**
   - Only 11ms per frame
   - Terrain can't load fast enough at high speeds

**Recommendation**: Start with 30x speed OR reduce graphics to medium quality to guarantee smooth 90 FPS.

---

## Quick Fixes

### If Frame Drops Occur:

**1. Immediate (No code change)**
```bash
# Run with lower speed
?animationSpeed=30
```

**2. Short-term (Config change)**
```typescript
// In useViewerInit.ts
maximumScreenSpaceError: 2.5  // Was 1.5
shadows: false  // Was true
```

**3. Long-term (Add adaptive system)**
Implement dynamic speed adjustment from Strategy 1.

---

## Summary

**Current State**:
- Speed: 50x (configurable via URL)
- FPS Target: 90
- Quality: Maximum (may cause frame drops)

**Optimal for Zero Frame Drops**:
- Speed: 30-40x (with current quality)
- OR Speed: 50x with reduced quality
- OR Adaptive system that adjusts on the fly

**For Fastest Recording**:
- Speed: 75-100x
- FPS: 60
- Quality: Medium
- Trade-off: Noticeable quality reduction
