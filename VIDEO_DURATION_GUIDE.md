# Video Duration Control Guide

## Understanding Time in Route Videos

Your GPX route has:
- **Actual duration**: Time between first and last waypoint (e.g., 95 minutes)
- **Animation speed**: How fast the route plays (set in CesiumViewer.tsx)
- **Recording duration**: How long to record the video

## Recording Duration Options

### Option 1: Auto-Calculate (Default)

The system automatically calculates the recording duration from your GPX file:

```bash
docker run --rm -v "$(pwd)/output:/output" cesium-route-recorder
```

**Formula:**
```
Recording Time = (GPX Duration / Animation Speed) + 10 seconds buffer
```

**Example:**
- GPX duration: 95 minutes (5700 seconds)
- Animation speed: 10x (from CesiumViewer.tsx: `clock.multiplier = 10`)
- Recording time: (5700 / 10) + 10 = **580 seconds (9.7 minutes)**

### Option 2: Manual Duration

Override with specific duration in seconds:

```bash
docker run --rm \
  -v "$(pwd)/output:/output" \
  -e RECORD_DURATION=60 \
  cesium-route-recorder
```

**Use cases:**
- Quick preview (30-60 seconds)
- Specific segment only
- Testing

### Option 3: Custom Animation Speed

Control playback speed without changing code:

```bash
docker run --rm \
  -v "$(pwd)/output:/output" \
  -e ANIMATION_SPEED=20 \
  cesium-route-recorder
```

This calculates: `(GPX Duration / 20) + 10 seconds`

**Speed options:**
- `1` = Real-time (very slow for long routes)
- `5` = 5x speed
- `10` = 10x speed (default)
- `20` = 20x speed (faster animation)
- `50` = 50x speed (very fast)

**Note:** This only affects recording duration calculation. To actually change animation speed, modify `CesiumViewer.tsx`:

```typescript
viewer.clock.multiplier = 20; // Change from 10 to 20
```

## Time Calculation Examples

### Example 1: Your Default Alps Trail
```
GPX times: 2024-01-01T08:00:00Z to 2024-01-01T09:35:00Z
Duration: 95 minutes
Animation speed: 10x
Recording: (95 * 60 / 10) + 10 = 580 seconds = 9.7 minutes
Video size: ~50-100 MB
```

### Example 2: Short Hike
```
GPX duration: 30 minutes
Animation speed: 10x
Recording: (30 * 60 / 10) + 10 = 190 seconds = 3.2 minutes
```

### Example 3: Long Trek
```
GPX duration: 4 hours (240 minutes)
Animation speed: 20x (faster)
Recording: (240 * 60 / 20) + 10 = 730 seconds = 12.2 minutes
```

### Example 4: Quick Preview
```
Manual override: 60 seconds
Captures: First 10 minutes of route at 10x speed
```

## API Usage with Duration

### Auto-calculate:
```bash
curl -F "gpx=@my-route.gpx" http://localhost:3000/render-route
```

### Manual duration:
```bash
curl -F "gpx=@my-route.gpx" \
     -F "duration=120" \
     http://localhost:3000/render-route
```

### Using Node.js client:
```javascript
const { renderGPXRoute } = require('./client-example');

// Auto-calculate
await renderGPXRoute('path/to/route.gpx');

// Manual duration (120 seconds)
await renderGPXRoute('path/to/route.gpx', 120);
```

## Changing Animation Speed in Code

To permanently change animation speed, edit `src/CesiumViewer.tsx`:

```typescript
// Find this line (around line 122):
viewer.clock.multiplier = 10; // Speed up animation

// Change to desired speed:
viewer.clock.multiplier = 20; // 20x speed
viewer.clock.multiplier = 5;  // 5x speed
viewer.clock.multiplier = 1;  // Real-time
```

Then rebuild the Docker image:
```bash
docker build -t cesium-route-recorder .
```

## Tips

### For Long Routes (>2 hours):
- Use animation speed 20x or higher
- Or record just a segment with manual duration

### For Short Routes (<30 minutes):
- Use animation speed 5x-10x
- Auto-calculate works well

### For Preview/Testing:
- Use `RECORD_DURATION=30` or `60`
- Quick feedback, small files

### For Final Video:
- Let it auto-calculate
- Captures the complete route
- Best quality

## Troubleshooting

**Video ends before route completes:**
- Increase `RECORD_DURATION` manually
- Or increase `ANIMATION_SPEED` to make animation faster
- Check GPX file has correct timestamps

**Video is too long/large:**
- Reduce recording duration
- Increase animation speed
- Record only a segment

**Animation is choppy:**
- Don't set animation speed too high (>50x)
- Increase recording duration for smoother playback
- Check system resources during recording
