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

// Ensure output dir exists
try {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
} catch (err) {
  console.error('Could not ensure output directory exists:', err && err.message);
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
    const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '30');
    const playbackDuration = gpxDuration / speedMultiplier;
    const totalDuration = Math.ceil(playbackDuration + 19); // Add 19s buffer

    console.log(`Animation speed: ${speedMultiplier}x`);
    console.log(`Calculated playback duration: ${(playbackDuration / 60).toFixed(1)} minutes`);
    console.log(`Recording duration (with buffer): ${totalDuration} seconds`);

    return totalDuration;
  }

  console.log('Using default duration: 60 seconds');
  return 60;
}

const RECORD_DURATION = getRecordingDuration();
const RECORD_FPS = parseInt(process.env.RECORD_FPS || '10'); // Reduced to 10 FPS for stable capture with terrain
const RECORD_WIDTH = 720;
const RECORD_HEIGHT = 1280;

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
  console.log('Starting FFmpeg-based route recording...');

  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: false, // Changed to false - need visible window for X11 capture
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
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
      '--force-device-scale-factor=1',
      '--start-fullscreen', // Changed from maximized to fullscreen
      '--kiosk' // Kiosk mode for proper fullscreen
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 });

  // Disable CPU throttling
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // Log browser console
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.error(`Browser console error: ${text}`);
    } else {
      console.log(`Browser console: ${text}`);
    }
  });

  // Load the app
  const gpxFilename = process.env.GPX_FILENAME;
  if (!gpxFilename) {
    throw new Error('GPX_FILENAME environment variable is required');
  }
  const userName = process.env.USER_NAME || 'Hiker';
  const animationSpeed = process.env.ANIMATION_SPEED || '30';
  const appUrl = `http://localhost:${PORT}/?gpx=${encodeURIComponent(gpxFilename)}&userName=${encodeURIComponent(userName)}&animationSpeed=${animationSpeed}`;

  console.log(`Loading Cesium app: ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Cesium to be ready
  try {
    await page.waitForSelector('.cesium-viewer', { timeout: 30000 });
    console.log('Cesium viewer initialized');
  } catch (error) {
    console.warn('Cesium viewer selector not found, continuing anyway...');
  }

  // Wait for animation ready
  console.log('Waiting for animation to be ready (terrain + imagery loading)...');
  
  // Start FFmpeg BEFORE waiting, so it captures the loading process
  const outputPath = '/output/route-video.mp4';
  
  console.log('Starting FFmpeg screen capture...');
  
  const ffmpegArgs = [
    '-f', 'x11grab',
    '-video_size', `${RECORD_WIDTH}x${RECORD_HEIGHT}`,
    '-framerate', String(RECORD_FPS),
    '-i', ':99.0', // DISPLAY :99, screen 0 (full screen, not offset)
    '-t', String(RECORD_DURATION), // Duration
    '-c:v', 'libx264',
    '-preset', 'ultrafast', // Changed from 'faster' to 'ultrafast' for minimal encoding overhead
    '-crf', '28', // Increased from 23 to 28 for faster encoding (lower quality but smoother capture)
    '-pix_fmt', 'yuv420p',
    '-vf', `crop=${RECORD_WIDTH}:${RECORD_HEIGHT}:0:0`, // Crop to exact size from top-left
    '-threads', '4', // Limit threads for encoding
    '-y', // Overwrite output
    outputPath
  ];

  console.log(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let ffmpegOutput = '';
  ffmpeg.stdout.on('data', (data) => {
    const output = data.toString();
    ffmpegOutput += output;
    console.log(`FFmpeg: ${output.trim()}`);
  });

  ffmpeg.stderr.on('data', (data) => {
    const output = data.toString();
    ffmpegOutput += output;
    // FFmpeg writes progress to stderr
    if (output.includes('frame=')) {
      console.log(output.trim());
    }
  });

  // Wait for FFmpeg to complete
  const ffmpegPromise = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg encoding completed successfully');
        resolve();
      } else {
        console.error(`FFmpeg exited with code ${code}`);
        fs.appendFileSync(ERROR_LOG_PATH, `FFmpeg failed with code ${code}\n${ffmpegOutput}\n`);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('FFmpeg process error:', err);
      reject(err);
    });
  });

  try {
    await ffmpegPromise;
    console.log('✅ Recording complete!');
    console.log(`📦 Video saved to ${outputPath}`);
  } catch (err) {
    console.error('Recording failed:', err);
    throw err;
  } finally {
    try { await browser.close(); } catch (e) { console.warn('Error closing browser:', e.message); }
    try { server.close(); } catch (e) { console.warn('Error closing server:', e.message); }
  }

  console.log('🎉 Recording process complete!');
}

recordRoute().catch((error) => {
  try { fs.appendFileSync(ERROR_LOG_PATH, `[${new Date().toISOString()}] fatal error: ${error && error.stack ? error.stack : error}\n`); } catch (e) {}
  console.error('Recording failed:', error);
  process.exit(1);
});
