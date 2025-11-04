const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const http = require('http');
const handler = require('serve-handler');
const path = require('path');
const fs = require('fs');

const PORT = 8080;

// Output directory inside the container (mounted by server)
const OUTPUT_DIR = path.resolve('/output');

// Ensure output dir exists
try {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
} catch (err) {
  // If we can't create the output dir, still continue and let console logs show the error
  console.error('Could not ensure output directory exists:', err && err.message);
}

// Simple file logger to persist runtime logs for debugging inside the output folder
const LOG_PATH = path.join(OUTPUT_DIR, 'recorder.log');
const ERROR_LOG_PATH = path.join(OUTPUT_DIR, 'recorder-error.log');
function appendLog(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { /* ignore */ }
}

// Mirror console output to the log file for post-mortem debugging
const _log = console.log;
const _warn = console.warn;
const _err = console.error;
console.log = (...args) => { _log.apply(console, args); appendLog(...args); };
console.warn = (...args) => { _warn.apply(console, args); appendLog(...args); };
console.error = (...args) => { _err.apply(console, args); appendLog(...args); };

process.on('uncaughtException', (err) => {
  try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] uncaughtException: ${err.stack || err}\n`); } catch (e) {}
  console.error('uncaughtException', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] unhandledRejection: ${reason && reason.stack ? reason.stack : reason}\n`); } catch (e) {}
  console.error('unhandledRejection', reason);
});

// Haversine formula to calculate distance between two lat/lon points in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Parse GPX file to get actual route duration
function getGPXDuration() {
  try {
    // Use GPX_FILENAME from environment
    const gpxFilename = process.env.GPX_FILENAME;
    if (!gpxFilename) {
      throw new Error('GPX_FILENAME environment variable is required');
    }
    const gpxPath = path.join(__dirname, 'dist', gpxFilename);
    console.log(`Reading GPX file: ${gpxPath}`);
    const gpxContent = fs.readFileSync(gpxPath, 'utf8');

    // Extract first and last timestamps
    const timeMatches = gpxContent.match(/<time>([^<]+)<\/time>/g);
    if (timeMatches && timeMatches.length >= 2) {
      const firstTime = new Date(timeMatches[0].match(/<time>([^<]+)<\/time>/)[1]);
      const lastTime = new Date(timeMatches[timeMatches.length - 1].match(/<time>([^<]+)<\/time>/)[1]);

      // Duration in seconds
      const durationSeconds = (lastTime - firstTime) / 1000;
      console.log(`GPX route duration from timestamps: ${(durationSeconds / 60).toFixed(1)} minutes`);

      return durationSeconds;
    }

    // If no timestamps, calculate based on distance
    console.log('No timestamps found, calculating duration from distance...');
    const trkptMatches = gpxContent.match(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g);

    if (trkptMatches && trkptMatches.length >= 2) {
      let totalDistance = 0;
      const points = trkptMatches.map(match => {
        const latMatch = match.match(/lat="([^"]+)"/);
        const lonMatch = match.match(/lon="([^"]+)"/);
        return {
          lat: parseFloat(latMatch[1]),
          lon: parseFloat(lonMatch[1])
        };
      });

      // Calculate total distance
      for (let i = 1; i < points.length; i++) {
        const distance = calculateDistance(
          points[i - 1].lat, points[i - 1].lon,
          points[i].lat, points[i].lon
        );
        totalDistance += distance;
      }

      // Assume walking speed of 5 km/h = 1.39 m/s
      const walkingSpeed = 1.39; // meters per second
      const durationSeconds = totalDistance / walkingSpeed;

      console.log(`Total route distance: ${(totalDistance / 1000).toFixed(2)} km`);
      console.log(`Estimated duration at 5 km/h: ${(durationSeconds / 60).toFixed(1)} minutes`);

      return durationSeconds;
    }
  } catch (error) {
    console.warn('Could not parse GPX duration, using default:', error.message);
  }
  return null;
}

// Calculate recording duration
function getRecordingDuration() {
  // Manual override
  if (process.env.RECORD_DURATION) {
    const duration = parseInt(process.env.RECORD_DURATION) * 1000;
    console.log(`Using manual duration: ${duration / 1000} seconds`);
    return duration;
  }

  // Auto-calculate from GPX
  const gpxDuration = getGPXDuration();
  if (gpxDuration) {
    // Get animation speed multiplier from environment or default to 10
    const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '10');

    // Calculate playback duration (route duration / speed multiplier)
    const playbackDuration = gpxDuration / speedMultiplier;

    // Add buffer: 8s for tile loading + 5s intro + 6s outro = 19s total
    const totalDuration = (playbackDuration + 19) * 1000;

    console.log(`Animation speed: ${speedMultiplier}x`);
    console.log(`Calculated playback duration: ${(playbackDuration / 60).toFixed(1)} minutes`);
    console.log(`Recording duration (with intro/outro buffer): ${(totalDuration / 1000).toFixed(1)} seconds`);

    return totalDuration;
  }

  // Default fallback
  console.log('Using default duration: 60 seconds');
  return 60 * 1000;
}

const RECORD_DURATION = getRecordingDuration();

async function startServer() {
  const server = http.createServer((request, response) => {
    return handler(request, response, {
      public: path.join(__dirname, 'dist'), // Serve from dist where GPX is mounted
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
  console.log('Starting route recording...');

  const server = await startServer();

  // Allow overriding recording FPS and resolution via environment variables
  // If running in a headless/container environment, automatically prefer
  // lower-quality but stable defaults unless explicit env vars are provided.
  const isHeadlessEnv = (process.env.HEADLESS === 'true' || process.env.HEADLESS === '1')

  // Default high-quality values
  const DEFAULT_FPS = 60
  const DEFAULT_WIDTH = 1080
  const DEFAULT_HEIGHT = 1920

  // Lower-quality defaults for headless/container runs
  const HEADLESS_FPS = 30
  const HEADLESS_WIDTH = 720
  const HEADLESS_HEIGHT = 1280

  const TARGET_FPS = parseInt(process.env.RECORD_FPS || (isHeadlessEnv ? String(HEADLESS_FPS) : String(DEFAULT_FPS)), 10)
  const RECORD_WIDTH = parseInt(process.env.RECORD_WIDTH || (isHeadlessEnv ? String(HEADLESS_WIDTH) : String(DEFAULT_WIDTH)), 10)
  const RECORD_HEIGHT = parseInt(process.env.RECORD_HEIGHT || (isHeadlessEnv ? String(HEADLESS_HEIGHT) : String(DEFAULT_HEIGHT)), 10)

  console.log(`HEADLESS mode: ${isHeadlessEnv}`)
  console.log(`Recording target FPS: ${TARGET_FPS}, resolution: ${RECORD_WIDTH}x${RECORD_HEIGHT}`)

  const browser = await puppeteer.launch({
    headless: false, // Use Xvfb virtual display instead of headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--use-gl=swiftshader', // Use SwiftShader software GL in containers for stability
      '--enable-unsafe-swiftshader', // Opt into SwiftShader (lower security; OK for trusted content)
      '--ignore-gpu-blacklist',
      '--disable-gpu', // Disable GPU to force software rendering
      '--disable-gpu-vsync', // Disable vsync for unlimited FPS
      '--disable-frame-rate-limit', // Remove frame rate limit
      '--disable-background-timer-throttling', // Prevent timer throttling
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=4096', // Increase JS heap for better performance
      `--window-size=${RECORD_WIDTH},${RECORD_HEIGHT}`,
      '--force-device-scale-factor=1', // Ensure 1:1 devicePixelRatio for consistent pixels
      '--start-maximized'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  });

  const page = await browser.newPage();
  // Set viewport with explicit deviceScaleFactor=1 to match the window-size and avoid HiDPI scaling
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 })

  // Disable CPU throttling to get maximum performance
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 }); // No throttling

  // Log browser console messages
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.error(`Browser console error: ${text}`);
    } else if (type === 'warning') {
      console.warn(`Browser console warning: ${text}`);
    } else {
      console.log(`Browser console: ${text}`);
    }
  });

  // Log page errors
  page.on('pageerror', error => {
    console.error(`Page error: ${error.message}`);
  });

  // Get GPX filename from environment
  const gpxFilename = process.env.GPX_FILENAME;
  if (!gpxFilename) {
    throw new Error('GPX_FILENAME environment variable is required');
  }
  const appUrl = `http://localhost:${PORT}/?gpx=${encodeURIComponent(gpxFilename)}`;

  // Navigate to the app FIRST
  console.log(`Loading Cesium app with GPX: ${gpxFilename}`);
  await page.goto(appUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  console.log('Cesium app loaded, waiting for initialization...');

  // Log page inner size and devicePixelRatio for diagnostics (this will be captured by page.on('console'))
  try {
    await page.evaluate(() => {
      // eslint-disable-next-line no-console
      console.log(`VIEWPORT: ${window.innerWidth}x${window.innerHeight} DPR:${window.devicePixelRatio}`);
    });
  } catch (e) {
    console.warn('Could not evaluate viewport diagnostics:', e && e.message ? e.message : e);
  }

  // Wait for Cesium viewer to be created
  try {
    await page.waitForSelector('.cesium-viewer', { timeout: 30000 });
    console.log('Cesium viewer initialized');
  } catch (error) {
    console.warn('Cesium viewer selector not found, continuing anyway...');
  }

  // Wait for the animation ready marker (terrain + imagery loaded)
  console.log('Waiting for animation to be ready...');
  try {
    await page.waitForFunction(
      () => window.CESIUM_ANIMATION_READY === true,
      { timeout: 60000 } // Increased timeout for terrain loading
    );
    console.log('Animation is ready!');
  } catch (error) {
    console.warn('Animation ready marker not found after 60s, starting recording anyway...');
  }

  // NOW start recording after everything is loaded
  console.log('Setting up screen recorder...');
  
  // Calculate expected file size based on duration and bitrate
  const recordDurationMinutes = RECORD_DURATION / 1000 / 60;
  const bitrateKbps = 2500; // Must match videoBitrate below
  const estimatedSizeMB = (recordDurationMinutes * bitrateKbps * 60) / 8 / 1024;
  console.log(`Expected video duration: ${recordDurationMinutes.toFixed(2)} minutes`);
  console.log(`Estimated file size: ${estimatedSizeMB.toFixed(2)} MB (at ${bitrateKbps}k bitrate)`);
  
  if (estimatedSizeMB > 50) {
    console.warn(`⚠️  WARNING: Estimated file size (${estimatedSizeMB.toFixed(2)} MB) exceeds Telegram's 50MB limit!`);
    console.warn('Consider reducing bitrate or using shorter routes.');
  }
  
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: false,
    fps: TARGET_FPS, // configurable target FPS
    videoFrame: {
      width: RECORD_WIDTH,
      height: RECORD_HEIGHT,
    },
    aspectRatio: '9:16',
    videoCrf: 28, // Higher CRF = smaller file (18=high quality, 28=medium, 32=lower quality)
    videoCodec: 'libx264',
    videoPreset: 'medium', // Better compression than ultrafast
    videoBitrate: '2500k', // Reduced from 5000k to keep under 50MB for Telegram
  });

  let recordingStarted = false;
  try {
    await recorder.start('/output/route-video.mp4');
    recordingStarted = true;
    console.log('Recording started');

    console.log(`Recording animation for ${RECORD_DURATION / 1000} seconds...`);

    // Wait for animation duration
    await page.waitForTimeout(RECORD_DURATION);

    console.log('Stopping recording...');
    await recorder.stop();
    console.log('Recorder stopped successfully');
  } catch (err) {
    console.error('Error during recording lifecycle:', err && err.stack ? err.stack : err);
    try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] recording error: ${err && err.stack ? err.stack : err}\n`); } catch (e) {}
    throw err;
  } finally {
    try { await browser.close(); } catch (e) { console.warn('Error closing browser:', e && e.message); }
    try { server.close(); } catch (e) { console.warn('Error closing server:', e && e.message); }
  }

  console.log('Recording complete! Video saved to /output/route-video.mp4');
}

recordRoute().catch((error) => {
  // Persist final error to the error log for easier retrieval from host
  try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] fatal error: ${error && error.stack ? error.stack : error}\n`); } catch (e) {}
  console.error('Recording failed:', error);
  process.exit(1);
});
