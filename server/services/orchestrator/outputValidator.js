const fs = require('fs');
const path = require('path');
const dockerService = require('../dockerService');

/**
 * Output Validator
 *
 * Validates render output and checks for errors
 */

/**
 * Validate that video was created successfully
 */
function validateOutput(outputDir, dockerResult) {
  const videoPath = path.join(outputDir, 'route-video.mp4');

  // Check if video file exists
  if (!fs.existsSync(videoPath)) {
    return {
      success: false,
      error: 'Video file not created',
      dockerOutputs: {
        stdout: dockerService.trimOutput(dockerResult.stdout),
        stderr: dockerService.trimOutput(dockerResult.stderr)
      }
    };
  }

  const videoStats = fs.statSync(videoPath);

  // Check if file has content
  if (videoStats.size === 0) {
    return {
      success: false,
      error: 'Video file is empty',
      dockerOutputs: {
        stdout: dockerService.trimOutput(dockerResult.stdout),
        stderr: dockerService.trimOutput(dockerResult.stderr)
      }
    };
  }

  return {
    success: true,
    videoPath,
    videoStats,
    dockerOutputs: dockerResult
  };
}

module.exports = {
  validateOutput
};
