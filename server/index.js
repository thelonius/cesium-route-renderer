const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Configuration
const CONSTANTS = require('../config/constants');
const renderingConfig = require('../config/rendering');
const settingsService = require('./services/settingsService');
const routeAnalyzerService = require('./services/routeAnalyzerService');
const dockerService = require('./services/dockerService');
const geoMath = require('../utils/geoMath');

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

  // Perform complete route analysis using orchestrator service
  const routeProfile = routeAnalyzerService.analyzeComplete(gpxPath, settings);

  if (!routeProfile.success) {
    return res.status(400).json({
      error: 'Failed to analyze route',
      details: routeProfile.error || 'Unknown error',
      outputId
    });
  }

  // Extract analysis results from profile
  const routeAnalysis = routeProfile.route;
  const animationSpeed = routeProfile.speed.value;
  const speedResult = routeProfile.speed;
  const routePattern = routeProfile.pattern.details;
  const overlayHooks = routeProfile.overlays;

  // Log analysis results
  console.log(`🎬 Animation speed: ${animationSpeed}x - ${speedResult.reason}`);
  if (routeProfile.pattern.type !== 'unknown') {
    console.log(`🗺️  Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`   ${routeProfile.pattern.description}`);
  }
  console.log(`📊 Generated ${overlayHooks.hooks.length} overlay hooks for video`);
  console.log(`⚡ Analysis completed in ${routeProfile.metadata.analysisTime}ms`);

  // Calculate expected video duration
  let videoDurationSeconds = null;
  let routeDurationMinutes = null;
  let routeDurationSeconds = routeAnalysis.duration?.seconds || null;

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
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)\n`);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Overlay hooks: ${overlayHooks.hooks.length} generated\n`);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Analysis time: ${routeProfile.metadata.analysisTime}ms\n`);

  // Save overlay hooks and route metadata to JSON file for client access
  const overlayDataPath = path.join(outputDir, 'overlay-data.json');
  fs.writeFileSync(overlayDataPath, JSON.stringify({
    overlayHooks: overlayHooks,
    routePattern: routeProfile.pattern,
    routeMetadata: {
      distance: routeAnalysis.distance,
      elevation: routeAnalysis.elevation,
      terrain: routeAnalysis.terrain,
      routeType: routeAnalysis.routeType,
      metadata: routeAnalysis.metadata
    },
    camera: routeProfile.camera,
    animationSpeed: animationSpeed,
    videoDuration: videoDurationSeconds,
    analysisTime: routeProfile.metadata.analysisTime,
    generatedAt: new Date().toISOString()
  }, null, 2));

  // Run Docker container using service
  const containerInfo = dockerService.runContainer(
    {
      gpxPath: absGpxPath,
      gpxFilename,
      outputDir: absOutputDir,
      animationSpeed,
      userName,
      recording: {
        fps: dockerRecordFps,
        width: dockerRecordWidth,
        height: dockerRecordHeight
      },
      logPath
    },
    {
      onStdout: (text) => {
        // Real-time stdout logging handled by service
      },
      onStderr: (text) => {
        // Real-time stderr logging handled by service
      },
      onMemoryWarning: ({ rss }) => {
        console.warn(`High memory usage: ${rss}MB`);
      },
      onError: (error, { stdout, stderr }) => {
        console.error('Docker spawn error:', error);
        // Clean up uploaded file
        fs.unlinkSync(gpxFile.path);

        return res.status(500).json({
          error: 'Failed to start Docker container',
          details: error.message,
          outputId,
          stdout: dockerService.trimOutput(stdout),
          stderr: dockerService.trimOutput(stderr),
          logsUrl: `/logs/${outputId}`,
          logsTextUrl: `/logs/${outputId}/text`
        });
      },
      onClose: (code, { stdout, stderr }) => {
        // Clean up uploaded file
        fs.unlinkSync(gpxFile.path);

        if (code !== 0) {
          console.error(`Docker process exited with code ${code}`);

          return res.status(500).json({
            error: 'Failed to render video',
            details: `Docker exited with code ${code}`,
            outputId,
            stdout: dockerService.trimOutput(stdout),
            stderr: dockerService.trimOutput(stderr),
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
            routePattern: routeProfile.pattern, // Complete pattern info from analyzer
            overlayHooks: overlayHooks, // Include overlay hooks for UI system
            routeMetadata: { // Include route metadata for client
              distance: routeAnalysis.distance,
              elevation: routeAnalysis.elevation,
              terrain: routeAnalysis.terrain,
              routeType: routeAnalysis.routeType,
              metadata: routeAnalysis.metadata
            },
            camera: routeProfile.camera, // Include camera profile
            analysisTime: routeProfile.metadata.analysisTime, // Include analysis performance
            logsUrl: `/logs/${outputId}`,
            logsTextUrl: `/logs/${outputId}/text`
          });
        } else {
          // If no video was created, include trimmed logs for debugging
          console.error('Video file not created. Docker stdout/stderr included in response.');
          res.status(500).json({
            error: 'Video file not created',
            outputId, // Include outputId so logs can be accessed
            stdout: dockerService.trimOutput(stdout),
            stderr: dockerService.trimOutput(stderr),
            logsUrl: `/logs/${outputId}`,
            logsTextUrl: `/logs/${outputId}/text`
          });
        }
      }
    }
  );
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
