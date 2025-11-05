const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Serve output files
app.use('/output', express.static(path.join(__dirname, '../output')));

app.post('/render-route', upload.single('gpx'), async (req, res) => {
  const gpxFile = req.file;
  // Use client-provided outputId if available, otherwise generate one
  const outputId = req.body.outputId || `route_${Date.now()}`;
  const outputDir = path.join(__dirname, '../output', outputId);

  if (!gpxFile) {
    return res.status(400).json({ error: 'No GPX file provided' });
  }

  console.log(`Starting render for output ID: ${outputId}`);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true});

  // Use simple filename based on timestamp
  const gpxFilename = `${Date.now()}.gpx`;
  const gpxPath = path.join(outputDir, gpxFilename);
  fs.copyFileSync(gpxFile.path, gpxPath);

  // Get absolute paths
  const absGpxPath = path.resolve(gpxPath);
  const absOutputDir = path.resolve(outputDir);

  // Run Docker container with the GPX file and filename
  // Don't pass RECORD_DURATION - let the script auto-calculate from GPX
  // Defaults for recorder envs - these can be overridden by setting the corresponding
  // env vars on the server process (e.g. RECORD_FPS, RECORD_WIDTH, RECORD_HEIGHT).
  const dockerHeadless = '1'; // Force headless-quality defaults inside the container
  const dockerRecordFps = process.env.RECORD_FPS || '30';
  const dockerRecordWidth = process.env.RECORD_WIDTH || '720';
  const dockerRecordHeight = process.env.RECORD_HEIGHT || '1280';

  const dockerCommand = `docker run --rm \
    --cpus="4" \
    --memory="4g" \
    --shm-size=2g \
    -v "${absGpxPath}:/app/dist/${gpxFilename}:ro" \
    -v "${absOutputDir}:/output" \
    -e GPX_FILENAME=${gpxFilename} \
    -e ANIMATION_SPEED=100 \
    -e HEADLESS=${dockerHeadless} \
    -e RECORD_FPS=${dockerRecordFps} \
    -e RECORD_WIDTH=${dockerRecordWidth} \
    -e RECORD_HEIGHT=${dockerRecordHeight} \
    cesium-route-recorder`;

  console.log('Running Docker command:', dockerCommand);

  // Increase maxBuffer to capture larger Docker/Chromium logs and return them on error (trimmed)
  // Set timeout to 60 minutes (3600000ms) - long routes can take 30-45 minutes to encode
  const execOptions = {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 3600000 // 60 minutes
  };

  exec(dockerCommand, execOptions, (error, stdout, stderr) => {
    // Clean up uploaded file
    fs.unlinkSync(gpxFile.path);

    if (stdout) console.log('Docker stdout:', stdout);
    if (stderr) console.error('Docker stderr:', stderr);

    if (error) {
      console.error('Docker execution error:', error);

      // Helper to trim logs to a sensible size for API responses
      const trim = (s, n = 8000) => {
        if (!s) return '';
        return s.length > n ? '...TRUNCATED...\n' + s.slice(-n) : s;
      };

      return res.status(500).json({
        error: 'Failed to render video',
        details: error.message,
        outputId, // Include outputId so logs can be accessed
        stdout: trim(stdout),
        stderr: trim(stderr),
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
