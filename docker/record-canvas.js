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
    const speedMultiplier = parseInt(process.env.ANIMATION_SPEED || '30');
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
const RECORD_FPS = 30; // 30 FPS for smoother video (was 10)
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
  console.log('Starting Cesium canvas-based recording...');

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
      '--js-flags=--max-old-space-size=4096',
      `--window-size=${RECORD_WIDTH},${RECORD_HEIGHT}`,
      '--force-device-scale-factor=1'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RECORD_WIDTH, height: RECORD_HEIGHT, deviceScaleFactor: 1 });

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

  console.log('✅ Starting canvas frame capture...');
  const frameInterval = 1000 / RECORD_FPS;
  const totalFrames = Math.ceil(RECORD_DURATION * RECORD_FPS);
  let frameCount = 0;

  const startTime = Date.now();

  while (frameCount < totalFrames) {
    try {
      const targetTime = startTime + (frameCount * frameInterval);
      const now = Date.now();

      // Wait if we're ahead of schedule
      if (now < targetTime) {
        await new Promise(resolve => setTimeout(resolve, targetTime - now));
      }

      // Capture frame from canvas
      const frameDataBase64 = await page.evaluate(() => window.captureFrame());

      if (frameDataBase64) {
        const framePath = path.join(FRAMES_DIR, `frame-${String(frameCount).padStart(6, '0')}.jpg`);
        fs.writeFileSync(framePath, Buffer.from(frameDataBase64, 'base64'));

        frameCount++;

        if (frameCount === 1 || frameCount % 30 === 0) {
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

  // Close browser
  await browser.close();
  server.close();

  // Encode with FFmpeg
  const outputPath = '/output/route-video.mp4';
  const ffmpegArgs = [
    '-framerate', String(RECORD_FPS),
    '-i', path.join(FRAMES_DIR, 'frame-%06d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'medium', // Better quality than 'faster'
    '-crf', '20', // Higher quality (lower = better, was 23)
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
