const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const http = require('http');
const handler = require('serve-handler');
const path = require('path');
const fs = require('fs');
const constants = require('./config/constants.cjs');

const PORT = 8080;
const OUTPUT_DIR = path.resolve('/app/output');
const LOG_PATH = path.join(OUTPUT_DIR, 'recorder.log');
const ERROR_LOG_PATH = path.join(OUTPUT_DIR, 'recorder-error.log');
const FRAMES_DIR = path.join(OUTPUT_DIR, 'frames');

// Ensure directories exist
try {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR, { recursive: true });
} catch (err) {
  console.error('Could not ensure directories exist:', err && err.message);
}

// Get GPX duration
function getGPXDuration() {
  try {
    const gpxFilename = process.env.GPX_FILENAME;
    if (!gpxFilename) return null;

    // In Docker, GPX files are mounted at /app/public/
    const gpxPath = path.join('/app', 'public', gpxFilename);
    if (!fs.existsSync(gpxPath)) return null;

    const gpxContent = fs.readFileSync(gpxPath, 'utf8');

    // Extract only the track segment to avoid metadata times
    const trkMatch = gpxContent.match(/<trkseg>([\s\S]*)<\/trkseg>/);
    if (!trkMatch) return null;

    const trackSegment = trkMatch[1];
    const timeMatches = trackSegment.match(/<time>([^<]+)<\/time>/g);

    if (timeMatches && timeMatches.length >= 2) {
      const firstTime = new Date(timeMatches[0].replace(/<\/?time>/g, ''));
      const lastTime = new Date(timeMatches[timeMatches.length - 1].replace(/<\/?time>/g, ''));
      const durationSeconds = (lastTime - firstTime) / 1000;
      return durationSeconds > 0 ? durationSeconds : null;
    }
  } catch (err) {
    console.warn('Error reading GPX duration:', err.message);
  }
  return null;
}

// Calculate recording duration and animation speed
function getRecordingDuration() {
  if (process.env.RECORD_DURATION) {
    const duration = parseInt(process.env.RECORD_DURATION);
    console.log(`Using manual duration: ${duration} seconds`);
    return duration;
  }

  const gpxDuration = getGPXDuration();
  if (gpxDuration) {
    // Animation timing components (all configurable):
    const SETTLE_TIME = parseInt(process.env.SETTLE_TIME || '5'); // Real-time seconds
    const INTRO_TIME = parseInt(process.env.INTRO_TIME || '5'); // Real-time seconds for intro
    const OUTRO_TIME = parseInt(process.env.OUTRO_TIME || '5'); // Real-time seconds for outro
    const TARGET_ROUTE_TIME = parseInt(process.env.TARGET_ROUTE_TIME || '25'); // Target seconds for route

    // Calculate speed needed for route to fit target time
    // Route animation speed: gpxDuration / TARGET_ROUTE_TIME
    const calculatedRouteSpeed = Math.ceil(gpxDuration / TARGET_ROUTE_TIME);

    // Allow manual override of route speed
    const routeSpeed = process.env.ANIMATION_SPEED
      ? parseInt(process.env.ANIMATION_SPEED)
      : calculatedRouteSpeed;

    global.calculatedAnimationSpeed = routeSpeed;

    // Calculate actual durations
    const actualRouteTime = gpxDuration / routeSpeed;
    // Recording duration: we skip intro in recording, so just route + outro + small buffer
    const totalDuration = Math.ceil(actualRouteTime + OUTRO_TIME + 10);

    console.log(`\n=== Animation Parameters ===`);
    console.log(`Route duration: ${(gpxDuration / 60).toFixed(1)} min (${(gpxDuration / 3600).toFixed(1)} hours)`);
    console.log(`Route speed: ${routeSpeed}x ${process.env.ANIMATION_SPEED ? '(manual)' : '(auto-calculated)'}`);
    console.log(`\nVideo timing breakdown:`);
    console.log(`  Settle: ${SETTLE_TIME}s (not recorded - pre-animation)`);
    console.log(`  Intro:  ${INTRO_TIME}s (not recorded - runs before capture starts)`);
    console.log(`  Route:  ${actualRouteTime.toFixed(1)}s (RECORDED at ${routeSpeed}x speed)`);
    console.log(`  Outro:  ${OUTRO_TIME}s (RECORDED at 1x speed)`);
    console.log(`  Total Recording:  ${totalDuration}s (${(totalDuration / 60).toFixed(1)} min)`);
    console.log(`\nTo customize, set:`);
    console.log(`  Route:  ${actualRouteTime.toFixed(1)}s`);
    console.log(`  Outro:  ${OUTRO_TIME}s`);
    console.log(`  Total:  ${totalDuration}s (${(totalDuration / 60).toFixed(1)} min)`);
    console.log(`\nTo customize, set:`);
    console.log(`  SETTLE_TIME=${SETTLE_TIME} (globe loading, not recorded)`);
    console.log(`  INTRO_TIME=${INTRO_TIME} (camera animation, not recorded)`);
    console.log(`  TARGET_ROUTE_TIME=${TARGET_ROUTE_TIME} (desired route duration in video)`);
    console.log(`  OUTRO_TIME=${OUTRO_TIME} (final view, recorded)`);
    console.log(`  ANIMATION_SPEED=${routeSpeed} (or auto-calculate from TARGET_ROUTE_TIME)`);
    console.log(`===========================\n`);

    return totalDuration;
  }

  console.log('Using default duration: 60 seconds');
  return 60;
}

const RECORD_DURATION = getRecordingDuration();
const RECORD_FPS = constants.RENDER.DEFAULT_FPS; // Use centralized config
const RECORD_WIDTH = parseInt(process.env.RECORD_WIDTH || String(constants.RENDER.DEFAULT_WIDTH), 10);
const RECORD_HEIGHT = parseInt(process.env.RECORD_HEIGHT || String(constants.RENDER.DEFAULT_HEIGHT), 10);

// Status tracking
let statusInfo = {
  buildVersion: 'unknown',
  averageFps: 0,
  mapProvider: 'unknown',
  terrainQuality: 'unknown',
  avgFrameTime: 0,
  totalFrames: 0,
  startTime: null,
  frameTimes: [],
  routeDurationMinutes: 0,
  videoDurationMinutes: 0,
  animationSpeed: parseInt(process.env.ANIMATION_SPEED || '2')
};

// Convert terrain quality value to descriptive level
function getTerrainQualityLevel(errorValue) {
  if (errorValue <= 1) return 'Ultra High';
  if (errorValue <= 2) return 'High';
  if (errorValue <= 4) return 'Medium';
  if (errorValue <= 8) return 'Low';
  if (errorValue <= 16) return 'Very Low';
  return 'Minimal';
}

// Get build version
function getBuildVersion() {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return packageJson.version || 'dev';
    }
  } catch (err) {
    console.warn('Could not read package.json:', err.message);
  }
  return 'unknown';
}

// Display status bar
function displayStatusBar() {
  const elapsed = statusInfo.startTime ? ((Date.now() - statusInfo.startTime) / 1000).toFixed(1) : '0.0';
  const avgFps = statusInfo.frameTimes.length > 0 ?
    (statusInfo.frameTimes.length / (elapsed / 60)).toFixed(1) : '0.0';
  const avgFrameTime = statusInfo.frameTimes.length > 0 ?
    (statusInfo.frameTimes.reduce((a, b) => a + b, 0) / statusInfo.frameTimes.length).toFixed(2) : '0.00';

  // Format durations
  const routeDur = global.gpxDurationSeconds ? `${(global.gpxDurationSeconds / 60).toFixed(0)}m` : 'N/A';
  const videoDur = global.videoDurationSeconds ? `${(global.videoDurationSeconds / 60).toFixed(1)}m` : 'N/A';

  console.log(`📊 [v${statusInfo.buildVersion}] Speed:${statusInfo.animationSpeed}x | Route:${routeDur}→Video:${videoDur} | Map:${statusInfo.mapProvider} | Terrain:${statusInfo.terrainQuality} | FPS:${avgFps} | Frame:${avgFrameTime}ms`);
}

async function startServer() {
  const server = http.createServer((request, response) => {
    return handler(request, response, {
      public: path.join(__dirname, 'dist'),
      cleanUrls: true,
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

async function recordRoute() {
  console.log('Starting Cesium canvas-based recording...');

  // Initialize status tracking
  statusInfo.buildVersion = getBuildVersion();
  statusInfo.startTime = Date.now();

  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--ignore-gpu-blacklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=4096',
      `--window-size=${RECORD_WIDTH},${RECORD_HEIGHT}`,
      '--force-device-scale-factor=1',
      // Alpine Linux Chromium specific flags
      '--crash-dumps-dir=/tmp/crashpad',
      '--user-data-dir=/tmp/chrome-user-data',
      '--single-process',
      '--disable-extensions',
      '--disable-software-rasterizer'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    dumpio: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 });

  // Load the app
  const gpxFilename = process.env.GPX_FILENAME;
  if (!gpxFilename) {
    throw new Error('GPX_FILENAME environment variable is required');
  }
  const userName = process.env.USER_NAME || 'Hiker';
  // Use calculated speed from getRecordingDuration(), or fallback to env var or default
  const animationSpeed = global.calculatedAnimationSpeed || process.env.ANIMATION_SPEED || '200';
  const appUrl = `http://localhost:${PORT}/?gpx=${encodeURIComponent(gpxFilename)}&userName=${encodeURIComponent(userName)}&animationSpeed=${animationSpeed}&docker=true`;

  console.log(`Loading Cesium app: ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Wait for Cesium to initialize
  console.log('Waiting for Cesium viewer to initialize...');

  // Forward important browser console messages only
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    // Only log errors, warnings, or important info (not canvas/webgl spam)
    if (type === 'error' || type === 'warning' ||
        (type === 'log' && !text.includes('Canvas found') && !text.includes('WebGL context') && !text.includes('Captured frame'))) {
      console.log(`[Browser ${type}]`, text);
    }
  });

  // Wait for animation to be ready (signal from useCesiumAnimation.ts)
  console.log('Waiting for CESIUM_ANIMATION_READY signal...');
  // Sometimes initialization is slow under Docker/SwiftShader. Retry waiting with a longer timeout.
  const waitForAnimationReady = async () => {
    // Staged checks with informative logs to help debug slow initialization under SwiftShader
    console.log('Waiting for window.Cesium to be defined... (60s)');
    try {
      await page.waitForFunction(() => typeof window.Cesium !== 'undefined', { timeout: 60000 });
      console.log('window.Cesium detected');
    } catch (e) {
      console.warn('window.Cesium not detected within 60s:', e && e.message);
    }

    console.log('Waiting for canvas element to appear... (30s)');
    try {
      await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 30000 });
      console.log('Canvas element detected');
    } catch (e) {
      console.warn('Canvas not present within 30s:', e && e.message);
    }

    console.log('Waiting for Viewer instance or CESIUM_ANIMATION_READY flag... (120s)');
    try {
      await page.waitForFunction(() => {
        try {
          if (window.CESIUM_ANIMATION_READY === true) return true;
          if (window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances && window.Cesium.Viewer.instances[0]) {
            const viewer = window.Cesium.Viewer.instances[0];
            if (viewer && viewer.clock && viewer.clock.startTime) return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      }, { timeout: 120000 });
      console.log('✅ Animation ready (flag or viewer detected)');
      return;
    } catch (e) {
      // Last-ditch: log viewer state for debugging and then rethrow
      console.warn('Viewer/animation-ready check failed:', e && e.message);
      try {
        const debugState = await page.evaluate(() => {
          try {
            return {
              cesiumDefined: typeof window.Cesium !== 'undefined',
              viewerCount: window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances ? window.Cesium.Viewer.instances.length : 0,
              hasCanvas: !!document.querySelector('canvas'),
              cesiumAnimationReady: !!window.CESIUM_ANIMATION_READY
            };
          } catch (e) {
            return { error: e && e.message };
          }
        });
        console.log('Viewer debug state:', JSON.stringify(debugState));
      } catch (ex) {
        console.warn('Could not evaluate viewer debug state:', ex && ex.message);
      }
      throw e;
    }
  };

  await waitForAnimationReady();

  // Get rendering info from browser
  const renderInfo = await page.evaluate(() => {
    try {
      // Get map provider info
      let mapProvider = 'unknown';
      if (window.Cesium && window.Cesium.Viewer) {
        const viewer = window.Cesium.Viewer.instances[0];
        if (viewer && viewer.imageryLayers) {
          const layers = viewer.imageryLayers;
          for (let i = 0; i < layers.length; i++) {
            const layer = layers.get(i);
            if (layer && layer.imageryProvider) {
              const provider = layer.imageryProvider;
              if (provider.constructor.name.includes('IonImageryProvider')) {
                if (provider._assetId === 2) mapProvider = 'Bing Maps';
                else if (provider._assetId === 3954) mapProvider = 'Sentinel-2';
                else mapProvider = `Cesium Ion (${provider._assetId})`;
              } else if (provider.constructor.name.includes('OpenStreetMap')) {
                mapProvider = 'OpenStreetMap';
              }
              break;
            }
          }
        }
      }

      // Get terrain quality
      let terrainQuality = 'unknown';
      if (window.Cesium && window.Cesium.Viewer) {
        const viewer = window.Cesium.Viewer.instances[0];
        if (viewer && viewer.scene && viewer.scene.globe) {
          const errorValue = viewer.scene.globe.maximumScreenSpaceError;
          if (errorValue !== undefined) {
            const qualityLevel = getTerrainQualityLevel(errorValue);
            terrainQuality = `${errorValue} (${qualityLevel})`;
          }
        }
      }

      return { mapProvider, terrainQuality };
    } catch (e) {
      console.warn('Could not get render info:', e.message);
      return { mapProvider: 'unknown', terrainQuality: 'unknown' };
    }
  });

  statusInfo.mapProvider = renderInfo.mapProvider;
  statusInfo.terrainQuality = renderInfo.terrainQuality;

  console.log(`🎨 Map Provider: ${statusInfo.mapProvider}`);
  console.log(`🏔️  Terrain Quality: ${statusInfo.terrainQuality}`);

  // Wait for intro animation to complete (runs at 1x speed for 5 seconds)
  // This prevents capturing blue screens and intro in the final video
  console.log('Waiting for intro animation to complete (5 seconds)...');
  await page.waitForTimeout(6000); // 5s intro + 1s buffer

  // Reset clock to start of route for recording (intro used up simulation time)
  await page.evaluate(() => {
    if (window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances[0]) {
      const viewer = window.Cesium.Viewer.instances[0];
      if (viewer.clock && viewer.clock.startTime) {
        viewer.clock.currentTime = window.Cesium.JulianDate.clone(viewer.clock.startTime);
        console.log('Clock reset to start time for recording');
      }
    }
  });

  // Force a render cycle before capturing
  console.log('Forcing render cycle...');
  await page.evaluate(() => {
    // Request animation frame to ensure rendering
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });

  console.log('Starting capture after intro...');

  // Inject canvas extraction function using toDataURL instead of toBlob
  // toDataURL works better with WebGL canvases even without preserveDrawingBuffer
  await page.evaluate(() => {
    window.captureFrame = async function() {
      try {
        // Find Cesium canvas - try specific class first, fall back to first canvas
        let canvas = document.querySelector('canvas.cesium-canvas');
        if (!canvas) {
          // Fallback: get the first canvas element (Cesium's viewer canvas)
          canvas = document.querySelector('canvas');
        }
        if (!canvas) {
          console.error('No canvas element found at all');
          console.error('Available canvases:', document.querySelectorAll('canvas').length);
          return null;
        }

        // Use toDataURL - it's synchronous and works better with WebGL
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (!dataUrl || dataUrl === 'data:,') {
            console.error('toDataURL returned empty string');
            console.error('This means canvas has not been drawn to yet');
            return null;
          }

          // Remove the data URL prefix to get just the base64
          const base64 = dataUrl.split(',')[1];
          return base64;
        } catch (e) {
          console.error('toDataURL exception:', e.message, e.stack);
          return null;
        }
      } catch (e) {
        console.error('captureFrame exception:', e.message, e.stack);
        return null;
      }
    };
  });

  // Debug: Check DOM state before testing capture
  const domInfo = await page.evaluate(() => {
    const cesiumCanvas = document.querySelector('canvas.cesium-canvas');
    const firstCanvas = document.querySelector('canvas');
    const allCanvases = document.querySelectorAll('canvas');
    return {
      cesiumCanvas: cesiumCanvas ? {
        width: cesiumCanvas.width,
        height: cesiumCanvas.height,
        className: cesiumCanvas.className
      } : null,
      firstCanvas: firstCanvas ? {
        width: firstCanvas.width,
        height: firstCanvas.height,
        className: firstCanvas.className,
        id: firstCanvas.id
      } : null,
      allCanvasCount: allCanvases.length,
      animationReady: window.CESIUM_ANIMATION_READY,
      hasViewer: !!window.Cesium?.Viewer
    };
  });
  console.log('DOM State:', JSON.stringify(domInfo, null, 2));

  // Test capture to verify setup
  console.log('Testing canvas capture...');
  const testFrame = await page.evaluate(() => window.captureFrame());
  if (!testFrame) {
    console.error('❌ Test capture failed! Canvas may not be ready.');
    console.log('Waiting additional 3 seconds and retrying...');
    await page.waitForTimeout(3000);

    // Check DOM again after wait
    const domInfo2 = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.cesium-canvas');
      return {
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        animationReady: window.CESIUM_ANIMATION_READY
      };
    });
    console.log('DOM State after wait:', JSON.stringify(domInfo2, null, 2));

    const retryFrame = await page.evaluate(() => window.captureFrame());
    if (!retryFrame) {
      throw new Error('Canvas capture not working - canvas toDataURL returns null even though canvas exists');
    }
  }
  console.log('✅ Test capture successful!');

  // Capture simulation metadata from the browser for debugging
  console.log('Collecting simulation metadata from browser...');
  try {
    const simInfo = await page.evaluate(() => {
      try {
        const viewer = window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances[0];
        if (!viewer || !viewer.clock) return { error: 'No viewer or clock found' };

        const start = viewer.clock.startTime ? window.Cesium.JulianDate.toIso8601(viewer.clock.startTime) : null;
        const stop = viewer.clock.stopTime ? window.Cesium.JulianDate.toIso8601(viewer.clock.stopTime) : null;
        const current = viewer.clock.currentTime ? window.Cesium.JulianDate.toIso8601(viewer.clock.currentTime) : null;
        const multiplier = typeof viewer.clock.multiplier !== 'undefined' ? viewer.clock.multiplier : null;
        const shouldAnimate = !!viewer.clock.shouldAnimate;
        const duration = (start && stop) ? window.Cesium.JulianDate.secondsDifference(window.Cesium.JulianDate.fromIso8601(stop), window.Cesium.JulianDate.fromIso8601(start)) : null;

        return { start, stop, current, multiplier, shouldAnimate, duration };
      } catch (e) {
        return { error: e && e.message };
      }
    });

    try {
      const metaPath = path.join(OUTPUT_DIR, 'recording-metadata.json');
      fs.writeFileSync(metaPath, JSON.stringify(simInfo, null, 2));
      console.log('✅ Wrote simulation metadata to', metaPath);
    } catch (e) {
      console.warn('Could not write simulation metadata file:', e && e.message);
    }

    console.log('Simulation metadata:', JSON.stringify(simInfo));
    if (simInfo && simInfo.duration && simInfo.duration < 5) {
      console.warn('⚠️ Simulation duration is very short (<5s). This may explain condensed animation in output.');
    }
  } catch (e) {
    console.warn('Failed to collect simulation metadata:', e && e.message);
  }

  console.log('✅ Starting canvas frame capture...');
  const frameInterval = 1000 / RECORD_FPS;
  const totalFrames = Math.ceil(RECORD_DURATION * RECORD_FPS);
  let frameCount = 0;

  const startTime = Date.now();

  while (frameCount < totalFrames) {
    const frameStartTime = Date.now();

    try {
      // Check if animation is complete (outro finished) - but don't stop recording
      const isComplete = await page.evaluate(() => window.CESIUM_ANIMATION_COMPLETE === true);
      if (isComplete && frameCount === 1) {
        console.log('ℹ️ Animation outro complete, but continuing recording for full duration');
      }

      // Instead of relying on Cesium's real-time clock multiplier we explicitly
      // step the Cesium clock to the desired simulation time for this frame.
      // This makes each captured frame correspond to a unique simulation time
      // and avoids duplicate images when the canvas isn't updating fast enough.
      const frameIndex = frameCount;
      await page.evaluate((frameIndex, totalFrames) => {
        try {
          const viewer = window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances[0];
          if (!viewer || !viewer.clock || !viewer.clock.startTime || !viewer.clock.stopTime) return;

          const start = viewer.clock.startTime;
          const stop = viewer.clock.stopTime;
          const duration = window.Cesium.JulianDate.secondsDifference(stop, start);
          const tSec = (frameIndex / Math.max(1, totalFrames - 1)) * duration;
          const newTime = window.Cesium.JulianDate.addSeconds(start, tSec, new window.Cesium.JulianDate());
          viewer.clock.currentTime = newTime;
        } catch (e) {
          console.warn('Failed to set viewer.clock.currentTime for frame:', e && e.message);
        }
      }, frameIndex, totalFrames);

      // Force two RAFs to make sure the canvas has painted the new frame
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // Capture frame from canvas
      const frameDataBase64 = await page.evaluate(() => window.captureFrame());

      if (frameDataBase64) {
        const framePath = path.join(FRAMES_DIR, `frame-${String(frameCount).padStart(6, '0')}.jpg`);
        fs.writeFileSync(framePath, Buffer.from(frameDataBase64, 'base64'));

        // Log the simulation time for this frame for diagnostics
        try {
          const simTimeIso = await page.evaluate(() => {
            try {
              const viewer = window.Cesium && window.Cesium.Viewer && window.Cesium.Viewer.instances[0];
              if (!viewer || !viewer.clock || !viewer.clock.currentTime) return null;
              return window.Cesium.JulianDate.toIso8601(viewer.clock.currentTime);
            } catch (e) {
              return null;
            }
          });
          if (simTimeIso) {
            const csvPath = path.join(OUTPUT_DIR, 'frame-times.csv');
            try {
              fs.appendFileSync(csvPath, `${frameCount},${simTimeIso}\n`);
            } catch (e) {
              // best-effort
            }
          }
        } catch (e) {
          // ignore
        }

        // Track frame timing
        const frameTime = Date.now() - frameStartTime;
        statusInfo.frameTimes.push(frameTime);
        statusInfo.totalFrames = frameCount + 1;

        frameCount++;

        if (frameCount === 1 || frameCount % 30 === 0) {
          displayStatusBar();
          const progress = ((frameCount / totalFrames) * 100).toFixed(1);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const animationTime = (frameCount / RECORD_FPS).toFixed(1);
          const eta = (((totalFrames - frameCount) / frameCount) * (Date.now() - startTime) / 1000).toFixed(0);
          console.log(`📹 Frame ${frameCount}/${totalFrames} (${progress}%) | Animation: ${animationTime}s | Elapsed: ${elapsed}s | ETA: ${eta}s`);
        }
      } else {
        console.warn(`⚠️ Frame ${frameCount} returned null, retrying...`);
        await page.waitForTimeout(100);
      }
    } catch (err) {
      console.error(`❌ Error capturing frame ${frameCount}:`, err.message);
      frameCount++;
    }
  }

  console.log('✅ All frames captured!');
  console.log('🎬 Starting FFmpeg encoding...');

  // Final status display
  displayStatusBar();

  // Close browser
  await browser.close();
  server.close();

  // Encode with FFmpeg
  const outputPath = path.join(OUTPUT_DIR, 'route-video.mp4');
  const ffmpegArgs = [
    '-framerate', String(RECORD_FPS),
    '-i', path.join(FRAMES_DIR, 'frame-%06d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23', // Good quality for 720p
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath
  ];

  console.log(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stdout.on('data', (data) => console.log(`FFmpeg: ${data.toString().trim()}`));
  ffmpeg.stderr.on('data', (data) => {
    const output = data.toString();
    if (output.includes('frame=')) {
      console.log(output.trim());
    }
  });

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Video encoding complete!');
        console.log(`📦 Video saved to ${outputPath}`);

        // Cleanup frames
        try {
          fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
          console.log('🧹 Cleaned up temporary frames');
        } catch (e) {
          console.warn('Could not cleanup frames:', e.message);
        }

        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });

  console.log('🎉 Recording process complete!');
}

recordRoute().catch((error) => {
  try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] fatal error: ${error && error.stack ? error.stack : error}\n`); } catch (e) {}
  console.error('Recording failed:', error);
  process.exit(1);
});
