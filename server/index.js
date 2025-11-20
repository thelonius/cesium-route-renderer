const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Configuration
const CONSTANTS = require('../config/constants');
const renderingConfig = require('../config/rendering');
const settingsService = require('./services/settingsService');
const renderOrchestratorService = require('./services/renderOrchestratorService');
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

  // Use render orchestrator service for complete render pipeline
  const renderResult = await renderOrchestratorService.startRender(
    {
      routeFilePath: routePath,
      routeFilename: routeFilename,
      outputDir: outputDir,
      outputId: outputId,
      userName: userName
    },
    {
      onProgress: (progress) => {
        console.log(`📊 Progress: ${progress.progress}% - ${progress.message}`);
      },
      onComplete: (result) => {
        // Clean up uploaded file
        fs.unlinkSync(gpxFile.path);
        res.json(result);
      },
      onError: (error) => {
        // Clean up uploaded file
        fs.unlinkSync(gpxFile.path);
        res.status(500).json(error);
      }
    }
  );
});

// Get status of a render job
app.get('/status/:outputId', (req, res) => {
  try {
    const outputId = req.params.outputId;

    // Check for active render first
    const activeRender = renderOrchestratorService.getRenderStatus(outputId);
    if (activeRender) {
      return res.json({
        status: activeRender.status,
        progress: activeRender.progress,
        stage: activeRender.currentStage,
        elapsed: activeRender.elapsed,
        logsUrl: `/logs/${outputId}`
      });
    }

    // Check for completed render
    const outputDir = path.join(__dirname, '../output', outputId);
    const videoPath = path.join(outputDir, 'route-video.mp4');

    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      return res.json({
        status: 'complete',
        videoUrl: `/output/${outputId}/route-video.mp4`,
        fileSize: stats.size,
        logsUrl: `/logs/${outputId}`
      });
    } else if (fs.existsSync(outputDir)) {
      return res.json({
        status: 'processing',
        logsUrl: `/logs/${outputId}`
      });
    } else {
      return res.status(404).json({
        status: 'not_found',
        error: `No render found with ID: ${outputId}`
      });
    }
  } catch (error) {
    console.error('Error checking render status:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Failed to check render status',
      details: error.message
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

// Camera settings API

// Get camera settings
app.get('/api/camera-settings', (req, res) => {
  try {
    const settings = settingsService.getAll();
    const cameraSettings = settings.camera || {
      defaultStrategy: 'follow',
      followDistance: 1500,
      followHeight: 1200,
      followTilt: -45,
      smoothing: 0.1,
      collisionDetection: false,
      terrainAdaptive: true
    };

    res.json({
      success: true,
      camera: cameraSettings
    });
  } catch (error) {
    console.error('Error reading camera settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read camera settings',
      details: error.message
    });
  }
});

// Update camera settings
app.put('/api/camera-settings', (req, res) => {
  try {
    const { camera } = req.body;

    if (!camera) {
      return res.status(400).json({
        success: false,
        error: 'Camera settings object required'
      });
    }

    // Validate camera settings
    const validation = validateCameraSettings(camera);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid camera settings',
        details: validation.errors
      });
    }

    // Update camera settings
    const success = settingsService.update('camera', camera);

    if (success) {
      console.log('Camera settings updated:', camera);
      res.json({
        success: true,
        camera: settingsService.get('camera')
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save camera settings'
      });
    }
  } catch (error) {
    console.error('Error updating camera settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update camera settings',
      details: error.message
    });
  }
});

// Get camera profile for a specific route pattern
app.get('/api/camera-profile/:patternType', (req, res) => {
  try {
    const patternType = req.params.patternType;
    const validPatterns = ['point-to-point', 'out-and-back', 'loop', 'figure-eight', 'multi-lap'];

    if (!validPatterns.includes(patternType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid pattern type. Must be one of: ${validPatterns.join(', ')}`
      });
    }

    // Get base camera settings
    const settings = settingsService.getAll();
    const baseCamera = settings.camera || {};

    // Apply pattern-specific adjustments (placeholder for Phase 6)
    const adjustments = getCameraAdjustmentsForPattern(patternType);

    res.json({
      success: true,
      patternType,
      baseSettings: baseCamera,
      adjustments,
      profile: { ...baseCamera, ...adjustments }
    });
  } catch (error) {
    console.error('Error getting camera profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get camera profile',
      details: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeRenders: renderOrchestratorService.getActiveRenders().length
  });
});

// Helper functions

/**
 * Validate camera settings
 */
function validateCameraSettings(camera) {
  const errors = [];

  if (camera.followDistance !== undefined) {
    if (typeof camera.followDistance !== 'number' || camera.followDistance < 100 || camera.followDistance > 10000) {
      errors.push('followDistance must be between 100 and 10000 meters');
    }
  }

  if (camera.followHeight !== undefined) {
    if (typeof camera.followHeight !== 'number' || camera.followHeight < 100 || camera.followHeight > 5000) {
      errors.push('followHeight must be between 100 and 5000 meters');
    }
  }

  if (camera.followTilt !== undefined) {
    if (typeof camera.followTilt !== 'number' || camera.followTilt < -90 || camera.followTilt > 0) {
      errors.push('followTilt must be between -90 and 0 degrees');
    }
  }

  if (camera.smoothing !== undefined) {
    if (typeof camera.smoothing !== 'number' || camera.smoothing < 0 || camera.smoothing > 1) {
      errors.push('smoothing must be between 0 and 1');
    }
  }

  if (camera.defaultStrategy !== undefined) {
    const validStrategies = ['follow', 'cinematic', 'bird-eye', 'first-person'];
    if (!validStrategies.includes(camera.defaultStrategy)) {
      errors.push(`defaultStrategy must be one of: ${validStrategies.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get camera adjustments for route pattern (placeholder for Phase 6)
 */
function getCameraAdjustmentsForPattern(patternType) {
  const adjustments = {
    'point-to-point': {
      heightMultiplier: 1.0,
      tiltAdjustment: 0,
      description: 'Standard follow camera'
    },
    'out-and-back': {
      heightMultiplier: 1.1,
      tiltAdjustment: -5,
      description: 'Slightly higher and steeper for turnaround visibility'
    },
    'loop': {
      heightMultiplier: 1.2,
      tiltAdjustment: -10,
      description: 'Higher perspective to show loop pattern'
    },
    'figure-eight': {
      heightMultiplier: 1.3,
      tiltAdjustment: -15,
      description: 'Elevated view to capture crossing point'
    },
    'multi-lap': {
      heightMultiplier: 1.15,
      tiltAdjustment: -8,
      description: 'Balanced height for lap visibility'
    }
  };

  return adjustments[patternType] || adjustments['point-to-point'];
}

const PORT = process.env.PORT || CONSTANTS.API.DEFAULT_PORT;

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Submit GPX files to http://localhost:${PORT}/render-route`);
});
