const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

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
  const MAX_VIDEO_MINUTES = 10; // Increased from 5 to 10 for slower, more viewable animation
  const MAX_FILE_SIZE_MB = 50;

  // Parse GPX/KML to estimate route duration
  let animationSpeed = 5; // Default 12x speed (reduced for better quality)
  try {
    const gpxContent = fs.readFileSync(gpxPath, 'utf8');
    const timeMatches = gpxContent.match(/<time>([^<]+)<\/time>|<when>([^<]+)<\/when>/g);

    if (timeMatches && timeMatches.length >= 2) {
      const firstTime = new Date(timeMatches[0].replace(/<\/?(?:time|when)>/g, ''));
      const lastTime = new Date(timeMatches[timeMatches.length - 1].replace(/<\/?(?:time|when)>/g, ''));
      const routeDurationMinutes = (lastTime - firstTime) / 1000 / 60;

      console.log(`Route duration: ${routeDurationMinutes.toFixed(1)} minutes`);

      // If duration is invalid (< 1 minute or negative), fall back to distance calculation
      if (routeDurationMinutes >= 1) {
        // Calculate required speed to keep video under MAX_VIDEO_MINUTES
        // Formula: (routeDuration / speed) + buffers <= MAX_VIDEO_MINUTES
        const requiredSpeed = Math.ceil(routeDurationMinutes / (MAX_VIDEO_MINUTES - 0.5)); // 0.5 min buffer

        if (requiredSpeed > 25) {
          animationSpeed = requiredSpeed;
          console.log(`⚡ Route is long, increasing animation speed to ${animationSpeed}x`);
          console.log(`Expected video length: ~${((routeDurationMinutes * 60 / animationSpeed) / 60).toFixed(1)} minutes`);
        } else {
          console.log(`✓ Using default speed 25x for ${routeDurationMinutes.toFixed(1)} min route`);
          console.log(`Expected video length: ~${((routeDurationMinutes * 60 / animationSpeed) / 60).toFixed(1)} minutes`);
        }
      } else {
        console.log('Duration invalid or too small, falling back to distance calculation...');
      }
    }

    // No timestamps or invalid duration - estimate from distance
    if (animationSpeed === 25 && (!timeMatches || timeMatches.length < 2)) {
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
        const walkingSpeed = 5; // km/h assumption
        const routeDurationMinutes = (distanceKm / walkingSpeed) * 60;

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
    console.warn('Could not parse file for duration, using default speed 25x:', err.message);
  }

  // Run Docker container with the GPX file and filename
  // Don't pass RECORD_DURATION - let the script auto-calculate from GPX
  // Defaults for recorder envs - these can be overridden by setting the corresponding
  // env vars on the server process (e.g. RECORD_FPS, RECORD_WIDTH, RECORD_HEIGHT).
  const dockerHeadless = '1'; // Force headless-quality defaults inside the container
  const dockerRecordFps = process.env.RECORD_FPS || '30';
  const dockerRecordWidth = process.env.RECORD_WIDTH || '720';
  const dockerRecordHeight = process.env.RECORD_HEIGHT || '1280';

  // Log to file so Telegram bot can read it
  const logPath = path.join(outputDir, 'recorder.log');
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] 🐳 Starting Docker container...\n`);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Animation speed: ${animationSpeed}x\n`);

  // Use spawn instead of exec to stream Docker output in real-time
  const dockerArgs = [
    'run',
    '--rm',
    '--shm-size=2g',
    '-v', `${absGpxPath}:/app/dist/${gpxFilename}:ro`,
    '-v', `${absOutputDir}:/output`,
    '-e', `GPX_FILENAME=${gpxFilename}`,
    '-e', `ANIMATION_SPEED=${animationSpeed}`,
    '-e', `USER_NAME=${userName}`,
    '-e', `HEADLESS=${dockerHeadless}`,
    '-e', `RECORD_FPS=${dockerRecordFps}`,
    '-e', `RECORD_WIDTH=${dockerRecordWidth}`,
    '-e', `RECORD_HEIGHT=${dockerRecordHeight}`
  ];

  // Try to enable GPU acceleration if available
  if (fs.existsSync('/dev/dri/card0')) {
    dockerArgs.push('--device=/dev/dri/card0');
    console.log('GPU device found, enabling hardware acceleration');
  }

  dockerArgs.push('cesium-route-recorder');  console.log('Running Docker command:', 'docker', dockerArgs.join(' '));

  const dockerProcess = spawn('docker', dockerArgs);

  let stdoutBuffer = '';
  let stderrBuffer = '';

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
    // Clean up uploaded file
    fs.unlinkSync(gpxFile.path);

    if (code !== 0) {
      console.error(`Docker process exited with code ${code}`);

      // Helper to trim logs to a sensible size for API responses
      const trim = (s, n = 8000) => {
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
      // Limit to last 4000 characters for Telegram's message limit
      if (logContent.length > 4000) {
        output += '...TRUNCATED...\n';
        output += logContent.slice(-4000);
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
  const daysOld = parseInt(req.query.daysOld) || 7; // Default to 7 days
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Submit GPX files to http://localhost:${PORT}/render-route`);
});
