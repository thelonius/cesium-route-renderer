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
  const outputId = `route_${Date.now()}`;
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
  const dockerCommand = `docker run --rm \
    --cpus="4" \
    --memory="4g" \
    --shm-size=2g \
    -v "${absGpxPath}:/app/dist/${gpxFilename}:ro" \
    -v "${absOutputDir}:/output" \
    -e GPX_FILENAME=${gpxFilename} \
    -e ANIMATION_SPEED=100 \
    cesium-route-recorder`;

  console.log('Running Docker command:', dockerCommand);

  exec(dockerCommand, (error, stdout, stderr) => {
    // Clean up uploaded file
    fs.unlinkSync(gpxFile.path);

    if (stdout) console.log('Docker stdout:', stdout);
    if (stderr) console.error('Docker stderr:', stderr);

    if (error) {
      console.error('Docker execution error:', error);
      return res.status(500).json({
        error: 'Failed to render video',
        details: error.message
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
        fileSize: stats.size
      });
    } else {
      res.status(500).json({ error: 'Video file not created' });
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
      fileSize: stats.size
    });
  } else if (fs.existsSync(outputDir)) {
    res.json({
      status: 'processing'
    });
  } else {
    res.status(404).json({
      status: 'not_found'
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
