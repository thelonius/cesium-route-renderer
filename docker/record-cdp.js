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

    // In Docker, GPX files are mounted at /app/public/
    const gpxPath = path.join('/app', 'public', gpxFilename);
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
    const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '2.5');
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
const RECORD_FPS = 5; // Target 5 FPS (reduced from 10 to prevent timeouts)
const RECORD_WIDTH = parseInt(process.env.RECORD_WIDTH || '720', 10);
const RECORD_HEIGHT = parseInt(process.env.RECORD_HEIGHT || '1280', 10);

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
  console.log('Starting CDP screenshot-based recording...');

  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: true,
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
      '--js-flags=--max-old-space-size=4096 --expose-gc',
      `--window-size=${RECORD_WIDTH},${RECORD_HEIGHT}`,
      '--force-device-scale-factor=1',
      '--single-process'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 });

  // Disable CPU throttling
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // Load the app
  const gpxFilename = process.env.GPX_FILENAME;
  if (!gpxFilename) {
    throw new Error('GPX_FILENAME environment variable is required');
  }
  const userName = process.env.USER_NAME || 'Hiker';
  const animationSpeed = process.env.ANIMATION_SPEED || '2.5';
  const appUrl = `http://localhost:${PORT}/?gpx=${encodeURIComponent(gpxFilename)}&userName=${encodeURIComponent(userName)}&animationSpeed=${animationSpeed}`;

  console.log(`Loading Cesium app: ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Cesium to initialize and start animation
  console.log('Waiting for Cesium viewer to initialize...');
  await page.waitForTimeout(10000);

  // Check viewer status
  const viewerStatus = await page.evaluate(() => {
    return {
      hasViewer: !!window.viewer,
      hasClock: !!(window.viewer && window.viewer.clock),
      clockShouldAnimate: window.viewer?.clock?.shouldAnimate,
      entities: window.viewer?.entities?.values?.length || 0
    };
  }).catch(() => ({ error: 'Could not check viewer status' }));

  console.log('Viewer status:', JSON.stringify(viewerStatus));
  console.log('✅ Starting screenshot capture...');

  console.log('Starting screenshot capture...');
  const frameInterval = 1000 / RECORD_FPS; // ms between frames
  const totalFrames = Math.ceil(RECORD_DURATION * RECORD_FPS);
  let frameCount = 0;
  let consecutiveErrors = 0;

  const startTime = Date.now();

  while (frameCount < totalFrames) {
    try {
      const targetTime = startTime + (frameCount * frameInterval);
      const now = Date.now();

      // Wait if we're ahead of schedule
      if (now < targetTime) {
        await new Promise(resolve => setTimeout(resolve, targetTime - now));
      }

      // Capture screenshot with timeout
      const screenshot = await Promise.race([
        page.screenshot({
          type: 'jpeg',
          quality: 80,
          encoding: 'binary'
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Screenshot timeout')), 10000)
        )
      ]);

      // Save frame
      const framePath = path.join(FRAMES_DIR, `frame-${String(frameCount).padStart(6, '0')}.jpg`);
      fs.writeFileSync(framePath, screenshot);

      consecutiveErrors = 0; // Reset error counter on success
      frameCount++;

      if (frameCount === 1 || frameCount % 10 === 0) {
        const progress = ((frameCount / totalFrames) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`📹 Captured ${frameCount}/${totalFrames} frames (${progress}%) - ${elapsed}s elapsed`);
      }

      // Force garbage collection every 50 frames
      if (frameCount % 50 === 0 && global.gc) {
        global.gc();
      }
    } catch (err) {
      console.error(`❌ Error capturing frame ${frameCount}:`, err.message);
      consecutiveErrors++;

      // If too many consecutive errors, abort
      if (consecutiveErrors > 10) {
        throw new Error('Too many consecutive screenshot failures - aborting');
      }

      // Try to continue with next frame
      frameCount++;
    }
  }

  console.log('✅ All frames captured!');
  console.log('🎬 Starting FFmpeg encoding...');

  // Close browser
  await browser.close();
  server.close();

  // Encode with FFmpeg
  const outputPath = '/output/route-video.mp4';
  const ffmpegArgs = [
    '-framerate', String(RECORD_FPS),
    '-i', path.join(FRAMES_DIR, 'frame-%06d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'faster',
    '-crf', '23',
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
