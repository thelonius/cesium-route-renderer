# Recording Progress Issue - Root Cause and Fix

## Problem Summary

Recording appeared "stuck" at 1/1800 seconds with very long estimated duration (~670 minutes remaining).

## Root Cause

The issue was a mismatch in default animation speeds:

1. **Server default**: 10x animation speed (line 63 in `server/index.js`)
2. **Docker script default**: 50x animation speed (line 262 in `docker/record-puppeteer.js`)
3. **User expectation**: 50x speed for reasonable video length

### What Happened

For the "227 - Архыз-Теберда 2024 .kml" route:
- Route real-time duration: ~5 hours (297 minutes from timestamps)
- Server set speed: 10x
- Calculated recording duration: (297 × 60 / 10) + 19 = **1800 seconds** (30 minutes!)
- Progress updates: Only every 30 seconds (was too infrequent)
- Result: Recording would take 30 minutes, progress appeared frozen

### Why 10x Was Used

The server logic had:
```javascript
let animationSpeed = 10; // Default
if (requiredSpeed > 10) { // Only increase if route needs faster speed
  animationSpeed = requiredSpeed;
}
```

For a 5-hour route at 10x speed:
- Video length = 297 / 10 = ~30 minutes (within MAX_VIDEO_MINUTES of 10)
- So speed stayed at 10x
- Recording would actually work but take 30 minutes

## Solution Implemented

### 1. Increased Default Animation Speed (50x)

**File**: `server/index.js`

Changed default from 10x to 50x:
```javascript
let animationSpeed = 50; // Default 50x for reasonable video length (5hr route = ~6min video)
```

Now for the same 5-hour route:
- Video length = 297 / 50 = ~6 minutes ✅
- Recording duration = (297 × 60 / 50) + 19 = **375 seconds** (6.25 minutes)
- Much more reasonable!

### 2. Fixed Speed Adjustment Logic

**File**: `server/index.js`

Updated threshold from 10x to 50x:
```javascript
if (requiredSpeed > 50) { // Only increase above 50x if needed
  animationSpeed = requiredSpeed;
} else {
  console.log(`✓ Using default ${animationSpeed}x speed`);
}
```

### 3. Increased Progress Update Frequency

**File**: `docker/record-puppeteer.js`

Changed from every 30 seconds to every 10 seconds:
```javascript
// Log progress more frequently - every 10 seconds instead of 30
if ((i + 1) % 5 === 0) { // 5 checks * 2s = 10s
  console.log(`📹 Recording progress: ${elapsedSeconds}/${recordingSeconds}s (${percentComplete}%)`);
}
```

### 4. Fixed Distance-Based Fallback

**File**: `server/index.js`

Added proper flag to track if timestamp-based duration was calculated:
```javascript
let hasValidDuration = false;
// ... timestamp calculation ...
hasValidDuration = true;

// No timestamps or invalid duration - estimate from distance
if (!hasValidDuration) {
  // Distance-based calculation
}
```

## Impact

### Before Fix
- 5-hour route → 30 minute recording (10x speed)
- Progress updates every 30 seconds
- Appeared stuck for first 30 seconds

### After Fix
- 5-hour route → 6-7 minute recording (50x speed)
- Progress updates every 10 seconds
- Clear progress visibility from start

### Speed Calculation Examples

| Route Duration | 10x Speed (Old) | 50x Speed (New) | Speed Chosen |
|---------------|-----------------|-----------------|--------------|
| 1 hour        | 6.3 min video   | 1.5 min video   | 50x         |
| 3 hours       | 18.3 min video  | 3.9 min video   | 50x         |
| 5 hours       | 30.3 min video  | 6.3 min video   | 50x         |
| 8 hours       | 48.3 min video  | 9.9 min video   | 50x         |
| 10 hours      | 60.3 min video  | 12.3 min video  | **64x** (auto-increased) |
| 20 hours      | N/A             | 24.3 min video  | **128x** (auto-increased) |

The system will now auto-increase speed only for routes longer than ~8.3 hours to keep videos under 10 minutes.

## Quality Impact

**50x speed is still very watchable:**
- Smooth terrain loading (GPU acceleration)
- 90 FPS recording captures all frames
- High-quality graphics (shadows, HDR, detailed terrain)
- No frame drops with GPU rendering

The clock multiplier documentation in `ANIMATION-OPTIMIZATION.md` shows that speeds up to 100x are achievable without frame drops on GPU hardware.

## Testing Recommendations

1. **Short routes** (< 1 hour): Will use 50x, ~1-2 minute videos
2. **Medium routes** (1-5 hours): Will use 50x, ~2-7 minute videos
3. **Long routes** (5-10 hours): Will use 50x, ~7-12 minute videos
4. **Very long routes** (> 10 hours): Will auto-increase speed to keep under 10 minutes

## Files Changed

1. `server/index.js`:
   - Line 63: Changed default speed from 10x to 50x
   - Lines 78-90: Updated speed adjustment logic with better logging
   - Lines 93-155: Fixed distance-based fallback logic

2. `docker/record-puppeteer.js`:
   - Lines 380-384: Changed progress update frequency from 30s to 10s

## Deployment

Changes need to be:
1. Committed to git
2. Pushed to GitHub
3. Deployed to GPU server (195.209.214.96)
4. Tested with the stuck route ("227 - Архыз-Теберда 2024 .kml")

Expected result:
- Recording should complete in ~6-7 minutes
- Progress updates every 10 seconds
- Final video ~6-7 minutes long, high quality
