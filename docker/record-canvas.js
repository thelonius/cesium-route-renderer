const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const http = require('http');
const handler = require('serve-handler');
const path = require('path');
const fs = require('fs');

const PORT = 8080;
const OUTPUT_DIR = path.resolve('/output');
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

    const gpxPath = path.join(__dirname, 'dist', gpxFilename);
    if (!fs.existsSync(gpxPath)) return null;

    const gpxContent = fs.readFileSync(gpxPath, 'utf8');
    const timeMatches = gpxContent.match(/<time>([^<]+)<\/time>/g);

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

// Calculate recording duration
function getRecordingDuration() {
  if (process.env.RECORD_DURATION) {
    const duration = parseInt(process.env.RECORD_DURATION);
    console.log(`Using manual duration: ${duration} seconds`);
    return duration;
  }

  const gpxDuration = getGPXDuration();
  if (gpxDuration) {
    const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '25');
    const playbackDuration = gpxDuration / speedMultiplier;
    const totalDuration = Math.ceil(playbackDuration + 19);

    console.log(`Animation speed: ${speedMultiplier}x`);
    console.log(`Calculated playback duration: ${(playbackDuration / 60).toFixed(1)} minutes`);
    console.log(`Recording duration (with buffer): ${totalDuration} seconds`);

    return totalDuration;
  }

  console.log('Using default duration: 60 seconds');
  return 60;
}

const RECORD_DURATION = getRecordingDuration();
const RECORD_FPS = 24; // 24 FPS for better CPU performance
const RECORD_WIDTH = 720;
const RECORD_HEIGHT = 1280;

// Status tracking
let statusInfo = {
  buildVersion: 'unknown',
  averageFps: 0,
  mapProvider: 'unknown',
  terrainQuality: 'unknown',
  avgFrameTime: 0,
  totalFrames: 0,
  startTime: null,
  frameTimes: []
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

  console.log(`📊 [${statusInfo.buildVersion}] FPS:${avgFps} | Map:${statusInfo.mapProvider} | Terrain:${statusInfo.terrainQuality} | Frame:${avgFrameTime}ms | Elapsed:${elapsed}s`);
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

  // Copy GPX file to dist directory so it can be served by the HTTP server
  const gpxFilename = process.env.GPX_FILENAME;
  if (!gpxFilename) {
    throw new Error('GPX_FILENAME environment variable is required');
  }

  // Check if GPX is already in dist (mounted by API) or in /app (manual run)
  const gpxDestPath = path.join(__dirname, 'dist', gpxFilename);
  const gpxSourcePath = path.join(__dirname, gpxFilename);

  if (!fs.existsSync(gpxDestPath)) {
    // GPX not in dist, try to copy from /app
    if (fs.existsSync(gpxSourcePath)) {
      fs.copyFileSync(gpxSourcePath, gpxDestPath);
      console.log(`Copied GPX file from ${gpxSourcePath} to ${gpxDestPath}`);
    } else {
      throw new Error(`GPX file not found at ${gpxSourcePath} or ${gpxDestPath}`);
    }
  } else {
    console.log(`Using GPX file already at ${gpxDestPath}`);
  }

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
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blacklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=4096',
      `--window-size=${RECORD_WIDTH},${RECORD_HEIGHT}`,
      '--force-device-scale-factor=1'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 });

  // Load the app (gpxFilename already set above)
  const userName = process.env.USER_NAME || 'Hiker';
  const animationSpeed = process.env.ANIMATION_SPEED || '30';
  const appUrl = `http://localhost:${PORT}/?gpx=${encodeURIComponent(gpxFilename)}&userName=${encodeURIComponent(userName)}&animationSpeed=${animationSpeed}`;

  console.log(`Loading Cesium app: ${appUrl}`);

  // Set Docker mode flag BEFORE page loads so animation knows to wait for capture ready
  await page.evaluateOnNewDocument(() => {
    window.__DOCKER_MODE = true;
    console.log('Docker mode detection:', { dockerMode: window.__DOCKER_MODE });
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
  await page.waitForFunction(() => window.CESIUM_ANIMATION_READY === true, { timeout: 60000 });
  console.log('✅ Animation ready!');

  // Get rendering info from browser
  const renderInfo = await page.evaluate(() => {
    try {
      // Use the global viewer reference set by useViewerInit.ts
      const viewer = window.__CESIUM_VIEWER;

      // Get map provider info
      let mapProvider = 'unknown';
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

      // Get terrain quality
      let terrainQuality = 'unknown';
      if (viewer && viewer.scene && viewer.scene.globe) {
        const errorValue = viewer.scene.globe.maximumScreenSpaceError;
        if (errorValue !== undefined) {
          const qualityLevel = getTerrainQualityLevel(errorValue);
          terrainQuality = `${errorValue} (${qualityLevel})`;
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

  // Wait an additional 2 seconds for the first frame to render
  console.log('Waiting for first frame to render...');
  await page.waitForTimeout(2000);

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

  console.log('Starting capture...');

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
      hasViewer: !!window.__CESIUM_VIEWER
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

  // IMPORTANT: Set up manual time control BEFORE signaling capture ready
  // This prevents the animation from running too fast and completing before we can capture
  console.log('🎬 Setting up manual time control BEFORE animation starts...');

  const animationInfo = await page.evaluate((fps, animSpeed) => {
    try {
      const viewer = window.__CESIUM_VIEWER;
      if (!viewer || !viewer.clock || !viewer.clock.startTime) {
        return {
          success: false,
          error: 'Viewer/clock not ready: ' + JSON.stringify({
            hasViewer: !!viewer,
            hasClock: !!viewer?.clock,
            hasStartTime: !!viewer?.clock?.startTime
          })
        };
      }

      // Get JulianDate class from the clock's time objects
      const JulianDate = viewer.clock.startTime.constructor;

      if (!JulianDate || typeof JulianDate.secondsDifference !== 'function') {
        return {
          success: false,
          error: 'JulianDate not available. Constructor name: ' + (viewer.clock.startTime.constructor?.name || 'unknown')
        };
      }

      // Get animation time bounds
      const startTime = viewer.clock.startTime;
      const stopTime = viewer.clock.stopTime;
      const totalSeconds = JulianDate.secondsDifference(stopTime, startTime);

      // Calculate time step per frame
      const secondsPerFrame = animSpeed / fps;

      console.log('Animation setup (before capture start):', {
        totalSeconds,
        secondsPerFrame,
        expectedFrames: Math.ceil(totalSeconds / secondsPerFrame)
      });

      // CRITICAL: Keep the clock paused! Don't let it run freely
      viewer.clock.shouldAnimate = false;
      viewer.clock.multiplier = 0; // Extra safety

      // Reset to start time
      viewer.clock.currentTime = JulianDate.clone(startTime);

      // Store for step function
      window.__CESIUM_JD_CLASS = JulianDate;
      window.__ANIM_SECONDS_PER_FRAME = secondsPerFrame;
      window.__ANIM_STOP_TIME = stopTime;
      window.__ANIM_START_TIME = startTime;

      // Mark manual control as active
      window.__MANUAL_TIME_CONTROL = true;

      // Create step function that will be called for each frame
      window.__stepAnimation = function() {
        const JD = window.__CESIUM_JD_CLASS;
        const viewer = window.__CESIUM_VIEWER;
        const secondsPerFrame = window.__ANIM_SECONDS_PER_FRAME;
        const stopTime = window.__ANIM_STOP_TIME;

        if (!viewer || !JD) {
          return { done: true, error: 'Viewer or JD not available' };
        }

        const current = viewer.clock.currentTime;
        const newTime = JD.addSeconds(current, secondsPerFrame, new JD());

        // Check if we've reached the end
        if (JD.compare(newTime, stopTime) >= 0) {
          viewer.clock.currentTime = JD.clone(stopTime);
          viewer.scene.requestRender();
          return { done: true };
        }

        viewer.clock.currentTime = newTime;
        viewer.scene.requestRender();

        return { done: false };
      };

      // Trigger initial render at start position
      viewer.scene.requestRender();

      return {
        success: true,
        totalSeconds,
        secondsPerFrame,
        expectedFrames: Math.ceil(totalSeconds / secondsPerFrame),
        startTime: JulianDate.toIso8601(startTime),
        stopTime: JulianDate.toIso8601(stopTime)
      };
    } catch (err) {
      return { success: false, error: 'Exception: ' + err.message + ' at ' + err.stack };
    }
  }, RECORD_FPS, parseInt(process.env.ANIMATION_SPEED || '30'));

  if (!animationInfo.success) {
    throw new Error('Failed to set up manual time control: ' + animationInfo.error);
  }

  console.log(`📊 Animation: ${animationInfo.totalSeconds.toFixed(0)}s total, ${animationInfo.secondsPerFrame.toFixed(2)}s per frame`);
  console.log(`📊 Expected frames: ${animationInfo.expectedFrames}`);
  console.log(`📊 Time range: ${animationInfo.startTime} to ${animationInfo.stopTime}`);

  // NOW signal capture ready - but the animation won't run on its own because we set shouldAnimate=false
  console.log('🎬 Signaling capture ready - manual time stepping will control animation');
  await page.evaluate(() => {
    window.CESIUM_CAPTURE_READY = true;
  });

  // Small wait to ensure the signal is processed
  await page.waitForTimeout(100);

  console.log('✅ Starting canvas frame capture...');
  const frameInterval = 1000 / RECORD_FPS;
  const totalFrames = Math.ceil(RECORD_DURATION * RECORD_FPS);
  let frameCount = 0;

  console.log(`📊 Capture config: ${totalFrames} frames, ${RECORD_DURATION}s duration, ${RECORD_FPS} FPS`);
  console.log(`📊 Frame interval: ${frameInterval.toFixed(2)}ms`);

  const startTime = Date.now();

  while (frameCount < totalFrames) {
    const frameStartTime = Date.now();

    try {
      // Step animation time BEFORE capturing frame (except for first frame)
      if (frameCount > 0) {
        const stepResult = await page.evaluate(() => {
          if (window.__stepAnimation) {
            return window.__stepAnimation();
          }
          return { done: false };
        });

        if (stepResult.done) {
          console.log('✅ Animation reached end of route, stopping recording');
          break;
        }

        // Wait for render to complete
        await page.waitForTimeout(50);
      }

      // Log frame stepping details for first few frames and every 100th frame
      if (frameCount < 3 || frameCount % 100 === 0) {
        const stepDetails = await page.evaluate(() => {
          try {
            const viewer = window.__CESIUM_VIEWER;
            const JulianDate = window.__CESIUM_JD_CLASS;
            if (!viewer || !JulianDate) {
              return { error: 'No viewer or JulianDate class' };
            }
            const start = viewer.clock.startTime;
            const stop = viewer.clock.stopTime;
            const current = viewer.clock.currentTime;
            return {
              simulationDuration: JulianDate.secondsDifference(stop, start),
              currentTime: JulianDate.secondsDifference(current, start),
              startTime: start.toString(),
              stopTime: stop.toString(),
              secondsPerFrame: window.__ANIM_SECONDS_PER_FRAME
            };
          } catch (e) {
            return { error: e && e.message };
          }
        });
        console.log(`📊 Frame ${frameCount} stepping:`, JSON.stringify(stepDetails));
      }

      // Force two RAFs to make sure the canvas has painted the new frame
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // Check if animation is complete (outro finished) - but only after capturing at least some frames
      if (frameCount > 30) {
        const isComplete = await page.evaluate(() => window.CESIUM_ANIMATION_COMPLETE === true);
        if (isComplete) {
          console.log('✅ Animation outro complete, stopping recording');
          break;
        }
      } else if (frameCount === 10) {
        // Log flag state at frame 10 for debugging
        const flagState = await page.evaluate(() => ({
          complete: window.CESIUM_ANIMATION_COMPLETE,
          ready: window.CESIUM_ANIMATION_READY,
          introComplete: window.CESIUM_INTRO_COMPLETE
        }));
        console.log('🔍 Flag state at frame 10:', JSON.stringify(flagState));
      }

      // Capture frame from canvas
      const frameDataBase64 = await page.evaluate(() => window.captureFrame());

      if (frameDataBase64) {
        const framePath = path.join(FRAMES_DIR, `frame-${String(frameCount).padStart(6, '0')}.jpg`);
        fs.writeFileSync(framePath, Buffer.from(frameDataBase64, 'base64'));

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
        console.log('Recording complete! Video saved to', outputPath);

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
