const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

/**
 * Render a GPX route as a video using the Cesium Route Recorder API
 * @param {string} gpxFilePath - Path to the GPX file
 * @param {number} duration - Duration in seconds to record (default: 60)
 * @returns {Promise<Object>} - Result with videoUrl and outputId
 */
async function renderGPXRoute(gpxFilePath, duration = 60) {
  if (!fs.existsSync(gpxFilePath)) {
    throw new Error(`GPX file not found: ${gpxFilePath}`);
  }

  const formData = new FormData();
  formData.append('gpx', fs.createReadStream(gpxFilePath));
  formData.append('duration', duration.toString());

  console.log(`Submitting GPX file: ${gpxFilePath}`);
  console.log(`Recording duration: ${duration} seconds`);

  try {
    const response = await axios.post('http://localhost:3000/render-route', formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000 // 5 minute timeout
    });

    console.log('✓ Video rendered successfully!');
    console.log('Video URL:', `http://localhost:3000${response.data.videoUrl}`);
    console.log('Output ID:', response.data.outputId);
    console.log('File size:', (response.data.fileSize / 1024 / 1024).toFixed(2), 'MB');

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Server error:', error.response.data);
    } else {
      console.error('Error rendering video:', error.message);
    }
    throw error;
  }
}

/**
 * Check the status of a render job
 * @param {string} outputId - The output ID from a previous render
 */
async function checkStatus(outputId) {
  try {
    const response = await axios.get(`http://localhost:3000/status/${outputId}`);
    console.log('Status:', response.data.status);
    if (response.data.videoUrl) {
      console.log('Video URL:', `http://localhost:3000${response.data.videoUrl}`);
    }
    return response.data;
  } catch (error) {
    console.error('Error checking status:', error.message);
    throw error;
  }
}

// Example usage
if (require.main === module) {
  const gpxPath = process.argv[2] || './public/alps-trail.gpx';
  const duration = parseInt(process.argv[3]) || 60;

  console.log('=== Cesium Route Recorder Client ===\n');

  renderGPXRoute(gpxPath, duration)
    .then(result => {
      console.log('\n=== Rendering Complete ===');
      console.log('Download your video:');
      console.log(`  curl -O http://localhost:3000${result.videoUrl}`);
    })
    .catch(err => {
      console.error('\n=== Rendering Failed ===');
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { renderGPXRoute, checkStatus };
