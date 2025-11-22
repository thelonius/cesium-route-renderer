const renderingConfig = require('../../../config/rendering');

/**
 * Config Builder
 *
 * Prepares render configuration from route analysis and settings
 */

/**
 * Prepare complete render configuration
 */
function prepareRenderConfig(routeProfile, inputConfig, settings) {
  const routeAnalysis = routeProfile.route;
  const animationSpeed = routeProfile.speed.value;

  // Calculate video duration
  let videoDurationSeconds = null;
  let routeDurationMinutes = null;
  const routeDurationSeconds = routeAnalysis.duration?.seconds || null;

  if (routeDurationSeconds) {
    videoDurationSeconds = renderingConfig.calculateVideoDuration(
      routeDurationSeconds,
      animationSpeed
    );
    routeDurationMinutes = (routeDurationSeconds / 60).toFixed(1);
    const videoDurationMinutes = (videoDurationSeconds / 60).toFixed(1);

    console.log(
      `📹 Route duration: ${routeDurationMinutes} min | ` +
      `Video duration: ${videoDurationMinutes} min | ` +
      `Speed: ${animationSpeed}x`
    );
  }

  // Get recording settings with defaults
  const dockerRecordFps = String(settings.recording?.fps || 30);
  const dockerRecordWidth = String(settings.recording?.width || 720);
  const dockerRecordHeight = String(settings.recording?.height || 1280);

  return {
    routeProfile,
    routeAnalysis,
    animationSpeed,
    videoDurationSeconds,
    routeDurationMinutes,
    routeDurationSeconds,
    recording: {
      fps: dockerRecordFps,
      width: dockerRecordWidth,
      height: dockerRecordHeight
    },
    paths: {
      routeFile: inputConfig.routeFilePath,
      routeFilename: inputConfig.routeFilename,
      outputDir: inputConfig.outputDir,
      outputId: inputConfig.outputId
    },
    userName: inputConfig.userName
  };
}

module.exports = {
  prepareRenderConfig
};
