const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Configuration
const CONSTANTS = require('../config/constants');
const dockerConfig = require('../config/docker');
const renderingConfig = require('../config/rendering');
const settingsService = require('./services/settingsService');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Start cleanup script
require('./cleanup-old-renders');

// Serve output files
app.use('/output', express.static(path.join(__dirname, '../output')));

app.post('/render-route', upload.single('gpx'), async (req, res) => {
  const gpxFile = req.file;
  // Use client-provided outputId if available, otherwise generate one
  const outputId = req.body.outputId || `route_${Date.now()}`;
  const userName = req.body.userName || 'Hiker'; // Get user's display name
  const outputDir = path.join(__dirname, '../output', outputId);

  if (!gpxFile) {
    return res.status(400).json({ error: 'No GPX file provided' });
  }

  console.log(`Starting render for output ID: ${outputId}, user: ${userName}`);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true});

  // Detect file type and use appropriate extension
  const originalName = gpxFile.originalname.toLowerCase();
  const isKML = originalName.endsWith('.kml');
  const fileExt = isKML ? '.kml' : '.gpx';
  const fileType = isKML ? 'KML' : 'GPX';

  console.log(`Processing ${fileType} file: ${originalName}`);

  // Use simple filename based on timestamp with correct extension
  const routeFilename = `${Date.now()}${fileExt}`;
  const routePath = path.join(outputDir, routeFilename);
  fs.copyFileSync(gpxFile.path, routePath);

  // Keep GPX variables for backwards compatibility with Docker script
  const gpxFilename = routeFilename;
  const gpxPath = routePath;

  // Get absolute paths
  const absGpxPath = path.resolve(gpxPath);
  const absOutputDir = path.resolve(outputDir);

  // Calculate adaptive animation speed based on route length
  // Goal: Keep video reasonable length and file size under 50MB
  
  // Load settings from service
  const settings = settingsService.load();
  let animationSpeed = settings.animation.defaultSpeed;
  const MAX_VIDEO_MINUTES = settings.animation.maxVideoMinutes;
  const ADAPTIVE_SPEED_ENABLED = settings.animation.adaptiveSpeedEnabled;

  let routeDurationSeconds = null; // Store route duration for video calculation

  // Only apply adaptive speed if enabled
  if (ADAPTIVE_SPEED_ENABLED) {
    try {
      const gpxContent = fs.readFileSync(gpxPath, 'utf8');
      const timeMatches = gpxContent.match(/<time>([^<]+)<\/time>|<when>([^<]+)<\/when>/g);

      if (timeMatches && timeMatches.length >= 2) {
        const firstTime = new Date(timeMatches[0].replace(/<\/?(?:time|when)>/g, ''));
        const lastTime = new Date(timeMatches[timeMatches.length - 1].replace(/<\/?(?:time|when)>/g, ''));
        const routeDurationMinutes = (lastTime - firstTime) / 1000 / 60;
        routeDurationSeconds = (lastTime - firstTime) / 1000; // Store for video duration calc

        console.log(`Route duration: ${routeDurationMinutes.toFixed(1)} minutes`);

        // If duration is invalid (< 1 minute or negative), fall back to distance calculation
        if (routeDurationMinutes >= 1) {
          // Calculate required speed to keep video under MAX_VIDEO_MINUTES
          // Formula: (routeDuration / speed) + buffers <= MAX_VIDEO_MINUTES
          const requiredSpeed = Math.ceil(routeDurationMinutes / (MAX_VIDEO_MINUTES - 0.5)); // 0.5 min buffer

          if (requiredSpeed > animationSpeed) {
            animationSpeed = requiredSpeed;
            console.log(`⚡ Route is long, increasing animation speed to ${animationSpeed}x`);
            console.log(`Expected video length: ~${((routeDurationMinutes * 60 / animationSpeed) / 60).toFixed(1)} minutes`);
          } else {
            console.log(`✓ Using default speed ${animationSpeed}x for ${routeDurationMinutes.toFixed(1)} min route`);
            console.log(`Expected video length: ~${((routeDurationMinutes * 60 / animationSpeed) / 60).toFixed(1)} minutes`);
          }
        } else {
          console.log('Duration invalid or too small, falling back to distance calculation...');
        }
      }

      // No timestamps or invalid duration - estimate from distance
      if (animationSpeed === settings.animation.defaultSpeed && (!timeMatches || timeMatches.length < 2)) {
        console.log('Estimating from route distance...');
        const trkptMatches = gpxContent.match(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g);

      if (trkptMatches && trkptMatches.length > 1) {
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
          const R = 6371000; // Earth radius in meters
          const lat1 = points[i-1].lat * Math.PI / 180;
          const lat2 = points[i].lat * Math.PI / 180;
          const deltaLat = (points[i].lat - points[i-1].lat) * Math.PI / 180;
          const deltaLon = (points[i].lon - points[i-1].lon) * Math.PI / 180;

          const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                    Math.cos(lat1) * Math.cos(lat2) *
                    Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          totalDistance += R * c;
        }

        const distanceKm = totalDistance / 1000;
        const walkingSpeed = CONSTANTS.GEO.DEFAULT_WALKING_SPEED_KMH;
        const routeDurationMinutes = (distanceKm / walkingSpeed) * 60;
        routeDurationSeconds = routeDurationMinutes * 60; // Store for video duration calc

        console.log(`Estimated route: ${distanceKm.toFixed(1)}km, ~${routeDurationMinutes.toFixed(0)} minutes at 5km/h`);

        const requiredSpeed = Math.ceil(routeDurationMinutes / (MAX_VIDEO_MINUTES - 0.5));
        console.log(`Calculated required speed: ${requiredSpeed}x for ${MAX_VIDEO_MINUTES} min video`);

        if (requiredSpeed > 25) {
          animationSpeed = requiredSpeed;
          console.log(`⚡ Route is long, increasing animation speed to ${animationSpeed}x`);
        } else {
          console.log(`✓ Using default speed 25x`);
        }
        console.log(`Expected video length: ~${((routeDurationMinutes * 60 / animationSpeed) / 60).toFixed(1)} minutes`);
      }
    }
    } catch (err) {
      console.warn('Could not parse file for duration, using default speed:', err.message);
    }
  } else {
    console.log(`Using fixed speed ${animationSpeed}x (adaptive speed disabled)`);
  }

  // Calculate expected video duration
  // Formula: (route duration / animation speed) + 19 seconds buffer
  let videoDurationSeconds = null;
  let routeDurationMinutes = null;
  if (routeDurationSeconds) {
    videoDurationSeconds = renderingConfig.calculateVideoDuration(routeDurationSeconds, animationSpeed);
    routeDurationMinutes = (routeDurationSeconds / 60).toFixed(1);
    const videoDurationMinutes = (videoDurationSeconds / 60).toFixed(1);
    console.log(`📹 Route duration: ${routeDurationMinutes} min | Video duration: ${videoDurationMinutes} min | Speed: ${animationSpeed}x`);
  }

  // Run Docker container with the GPX file and filename
  // Don't pass RECORD_DURATION - let the script auto-calculate from GPX
  // Load recording settings from settings.json
  const dockerHeadless = '1'; // Force headless-quality defaults inside the container
  const dockerRecordFps = process.env.RECORD_FPS || String(settings.recording?.fps || 30);
  const dockerRecordWidth = process.env.RECORD_WIDTH || String(settings.recording?.width || 720);
  const dockerRecordHeight = process.env.RECORD_HEIGHT || String(settings.recording?.height || 1280);

  // Log to file so Telegram bot can read it
  const logPath = path.join(outputDir, 'recorder.log');
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] 🐳 Starting Docker container...\n`);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Animation speed: ${animationSpeed}x\n`);

  // Use spawn instead of exec to stream Docker output in real-time
  const dockerArgs = dockerConfig.buildCompleteArgs({
    gpxPath: absGpxPath,
    gpxFilename,
    outputDir: absOutputDir,
    animationSpeed,
    userName,
    recording: {
      fps: dockerRecordFps,
      width: dockerRecordWidth,
      height: dockerRecordHeight
    }
  });  console.log('Running Docker command:', 'docker', dockerArgs.join(' '));

  const dockerProcess = spawn('docker', dockerArgs);

  let stdoutBuffer = '';
  let stderrBuffer = '';

  // Monitor memory usage during render
  let memoryCheckInterval;
  const startTime = Date.now();

  const logMemoryUsage = () => {
    const used = process.memoryUsage();
    const rss = Math.round(used.rss / 1024 / 1024); // MB
    const heapUsed = Math.round(used.heapUsed / 1024 / 1024); // MB
    const external = Math.round(used.external / 1024 / 1024); // MB
    const elapsed = Math.round((Date.now() - startTime) / 1000); // seconds

    const memLog = `[${new Date().toISOString()}] 📊 Memory: RSS ${rss}MB | Heap ${heapUsed}MB | External ${external}MB | Elapsed ${elapsed}s\n`;
    fs.appendFileSync(logPath, memLog);

    // Warn if memory usage is high
    if (rss > CONSTANTS.MEMORY.WARNING_THRESHOLD_MB) {
      const warnLog = `[${new Date().toISOString()}] ⚠️  High memory usage detected: ${rss}MB RSS\n`;
      fs.appendFileSync(logPath, warnLog);
      console.warn(warnLog.trim());
    }
  };

  // Log memory usage at configured interval
  memoryCheckInterval = setInterval(logMemoryUsage, CONSTANTS.MEMORY.CHECK_INTERVAL_MS);
  logMemoryUsage(); // Log initial state

  // Stream stdout to log file in real-time
  dockerProcess.stdout.on('data', (data) => {
    const text = data.toString();
    stdoutBuffer += text;
    fs.appendFileSync(logPath, text);
    console.log('Docker stdout:', text.trim());
  });

  // Stream stderr to log file in real-time
  dockerProcess.stderr.on('data', (data) => {
    const text = data.toString();
    stderrBuffer += text;
    fs.appendFileSync(logPath, text);
    console.error('Docker stderr:', text.trim());
  });

  dockerProcess.on('error', (error) => {
    console.error('Docker spawn error:', error);
    clearInterval(memoryCheckInterval); // Stop memory monitoring
    // Clean up uploaded file
    fs.unlinkSync(gpxFile.path);

    return res.status(500).json({
      error: 'Failed to start Docker container',
      details: error.message,
      outputId,
      logsUrl: `/logs/${outputId}`,
      logsTextUrl: `/logs/${outputId}/text`
    });
  });

  dockerProcess.on('close', (code) => {
    clearInterval(memoryCheckInterval); // Stop memory monitoring
    logMemoryUsage(); // Log final memory state

    // Clean up uploaded file
    fs.unlinkSync(gpxFile.path);

    if (code !== 0) {
      console.error(`Docker process exited with code ${code}`);

      // Helper to trim logs to a sensible size for API responses
      const trim = (s, n = CONSTANTS.API.LOG_TRIM_LENGTH) => {
        if (!s) return '';
        return s.length > n ? '...TRUNCATED...\n' + s.slice(-n) : s;
      };

      return res.status(500).json({
        error: 'Failed to render video',
        details: `Docker exited with code ${code}`,
        outputId,
        stdout: trim(stdoutBuffer),
        stderr: trim(stderrBuffer),
        logsUrl: `/logs/${outputId}`,
        logsTextUrl: `/logs/${outputId}/text`
      });
    }

    // Check if video file was created
    const videoPath = path.join(outputDir, 'route-video.mp4');
    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      res.json({
        success: true,
        videoUrl: `/output/${outputId}/route-video.mp4`,
        outputId,
        fileSize: stats.size,
        animationSpeed, // Include animation speed for client display
        videoDurationSeconds, // Include expected video duration
        routeDurationMinutes, // Include route duration
        videoWidth: parseInt(dockerRecordWidth, 10), // Include video resolution
        videoHeight: parseInt(dockerRecordHeight, 10),
        logsUrl: `/logs/${outputId}`,
        logsTextUrl: `/logs/${outputId}/text`
      });
    } else {
      // If no video was created, include trimmed logs for debugging
      const trim = (s, n = 8000) => {
        if (!s) return '';
        return s.length > n ? '...TRUNCATED...\n' + s.slice(-n) : s;
      };

      console.error('Video file not created. Docker stdout/stderr included in response.');
      res.status(500).json({
        error: 'Video file not created',
        outputId, // Include outputId so logs can be accessed
        stdout: trim(stdout),
        stderr: trim(stderr),
        logsUrl: `/logs/${outputId}`,
        logsTextUrl: `/logs/${outputId}/text`
      });
    }
  });
});

// Get status of a render job
app.get('/status/:outputId', (req, res) => {
  const outputId = req.params.outputId;
  const outputDir = path.join(__dirname, '../output', outputId);
  const videoPath = path.join(outputDir, 'route-video.mp4');

  if (fs.existsSync(videoPath)) {
    const stats = fs.statSync(videoPath);
    res.json({
      status: 'complete',
      videoUrl: `/output/${outputId}/route-video.mp4`,
      fileSize: stats.size,
      logsUrl: `/logs/${outputId}`
    });
  } else if (fs.existsSync(outputDir)) {
    res.json({
      status: 'processing',
      logsUrl: `/logs/${outputId}`
    });
  } else {
    res.status(404).json({
      status: 'not_found'
    });
  }
});

// Get logs for a render job
app.get('/logs/:outputId', (req, res) => {
  const outputId = req.params.outputId;
  const outputDir = path.join(__dirname, '../output', outputId);
  const logPath = path.join(outputDir, 'recorder.log');
  const errorLogPath = path.join(outputDir, 'recorder-error.log');

  if (!fs.existsSync(outputDir)) {
    return res.status(404).json({ error: 'Output directory not found' });
  }

  const logs = {
    outputId,
    standardLog: '',
    errorLog: '',
    timestamp: new Date().toISOString()
  };

  // Read standard log
  if (fs.existsSync(logPath)) {
    try {
      logs.standardLog = fs.readFileSync(logPath, 'utf8');
    } catch (error) {
      logs.standardLog = `Error reading log: ${error.message}`;
    }
  } else {
    logs.standardLog = 'Log file not yet created';
  }

  // Read error log
  if (fs.existsSync(errorLogPath)) {
    try {
      logs.errorLog = fs.readFileSync(errorLogPath, 'utf8');
    } catch (error) {
      logs.errorLog = `Error reading error log: ${error.message}`;
    }
  } else {
    logs.errorLog = 'No errors logged';
  }

  res.json(logs);
});

// Get logs for a render job in text format (useful for Telegram)
app.get('/logs/:outputId/text', (req, res) => {
  const outputId = req.params.outputId;
  const outputDir = path.join(__dirname, '../output', outputId);
  const logPath = path.join(outputDir, 'recorder.log');
  const errorLogPath = path.join(outputDir, 'recorder-error.log');

  if (!fs.existsSync(outputDir)) {
    return res.status(404).send('Output directory not found');
  }

  let output = `=== Logs for ${outputId} ===\n`;
  output += `Timestamp: ${new Date().toISOString()}\n\n`;

  // Read standard log
  output += '=== Standard Log ===\n';
  if (fs.existsSync(logPath)) {
    try {
      const logContent = fs.readFileSync(logPath, 'utf8');
      // Limit to last N characters for Telegram's message limit
      if (logContent.length > CONSTANTS.TELEGRAM.LOG_TRUNCATE_LENGTH) {
        output += '...TRUNCATED...\n';
        output += logContent.slice(-CONSTANTS.TELEGRAM.LOG_TRUNCATE_LENGTH);
      } else {
        output += logContent;
      }
    } catch (error) {
      output += `Error reading log: ${error.message}\n`;
    }
  } else {
    output += 'Log file not yet created\n';
  }

  output += '\n\n=== Error Log ===\n';
  // Read error log
  if (fs.existsSync(errorLogPath)) {
    try {
      const errorLogContent = fs.readFileSync(errorLogPath, 'utf8');
      output += errorLogContent;
    } catch (error) {
      output += `Error reading error log: ${error.message}\n`;
    }
  } else {
    output += 'No errors logged\n';
  }

  res.type('text/plain').send(output);
});

// Cleanup old renders
app.get('/cleanup', (req, res) => {
  const daysOld = parseInt(req.query.daysOld) || CONSTANTS.CLEANUP.DEFAULT_AGE_DAYS;
  const outputBaseDir = path.join(__dirname, '../output');

  try {
    const now = Date.now();
    const cutoffTime = now - (daysOld * 24 * 60 * 60 * 1000);

    let deletedCount = 0;
    let freedSpaceBytes = 0;
    let remainingCount = 0;

    // Get all route directories
    const entries = fs.readdirSync(outputBaseDir);

    for (const entry of entries) {
      if (!entry.startsWith('route_')) continue;

      const dirPath = path.join(outputBaseDir, entry);
      const stats = fs.statSync(dirPath);

      if (!stats.isDirectory()) continue;

      // Check if older than cutoff
      if (stats.mtimeMs < cutoffTime) {
        // Calculate size before deletion
        const videoPath = path.join(dirPath, 'route-video.mp4');
        if (fs.existsSync(videoPath)) {
          const videoStats = fs.statSync(videoPath);
          freedSpaceBytes += videoStats.size;
        }

        // Delete the directory
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
          deletedCount++;
          console.log(`Deleted old render: ${entry}`);
        } catch (err) {
          console.error(`Failed to delete ${entry}:`, err);
        }
      } else {
        remainingCount++;
      }
    }

    res.json({
      success: true,
      deletedCount,
      freedSpaceMB: freedSpaceBytes / 1024 / 1024,
      remainingCount,
      daysOld
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Settings management

// Get current settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = settingsService.getAll();
    res.json(settings);
  } catch (error) {
    console.error('Error reading settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// Update settings
app.put('/api/settings', (req, res) => {
  try {
    const newSettings = req.body;

    // Validate settings
    if (newSettings.animation) {
      const validation = settingsService.validateAnimationSpeed(newSettings.animation.defaultSpeed);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
    }

    const success = settingsService.updateAll(newSettings);
    if (success) {
      console.log('Settings updated:', newSettings);
      res.json({ success: true, settings: settingsService.getAll() });
    } else {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get animation speed specifically (for route analytics integration)
app.get('/api/animation-speed', (req, res) => {
  try {
    const animSettings = settingsService.getAnimationSettings();
    res.json({
      speed: animSettings.defaultSpeed,
      adaptiveEnabled: animSettings.adaptiveSpeedEnabled,
      minSpeed: animSettings.minSpeed,
      maxSpeed: animSettings.maxSpeed
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read animation speed' });
  }
});

// Update animation speed specifically
app.put('/api/animation-speed', (req, res) => {
  try {
    const { speed, adaptiveEnabled } = req.body;
    const animSettings = settingsService.getAnimationSettings();

    if (speed !== undefined) {
      const validation = settingsService.validateAnimationSpeed(speed);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      settingsService.update('animation.defaultSpeed', speed);
    }

    if (adaptiveEnabled !== undefined) {
      settingsService.update('animation.adaptiveSpeedEnabled', adaptiveEnabled);
    }

    const updatedSettings = settingsService.getAnimationSettings();
    console.log(`Animation speed updated to ${updatedSettings.defaultSpeed}x (adaptive: ${updatedSettings.adaptiveSpeedEnabled})`);
    res.json({ 
      success: true, 
      speed: updatedSettings.defaultSpeed, 
      adaptiveEnabled: updatedSettings.adaptiveSpeedEnabled 
    });
  } catch (error) {
    console.error('Error updating animation speed:', error);
    res.status(500).json({ error: 'Failed to update animation speed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || CONSTANTS.API.DEFAULT_PORT;

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Submit GPX files to http://localhost:${PORT}/render-route`);
});
