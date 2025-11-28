const fs = require('fs');
const path = require('path');

/**
 * Metadata Builder
 *
 * Handles logging, file generation, and response data construction
 */

/**
 * Log route analysis results to console and file
 */
function logAnalysisResults(routeProfile, outputDir) {
  const logPath = path.join(outputDir, 'recorder.log');

  console.log(`🎬 Animation speed: ${routeProfile.speed.value}x - ${routeProfile.speed.reason}`);

  if (routeProfile.pattern.type !== 'unknown') {
    console.log(`🗺️  Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`   ${routeProfile.pattern.description}`);
  }

  console.log(`📊 Generated ${routeProfile.overlays.hooks.length} overlay hooks for video`);
  console.log(`⚡ Analysis completed in ${routeProfile.metadata.analysisTime}ms`);

  // Write to log file
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] 🐳 Starting render operation...\n`);
  fs.appendFileSync(logPath, `[${timestamp}] Animation speed: ${routeProfile.speed.value}x\n`);
  fs.appendFileSync(logPath, `[${timestamp}] Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)\n`);
  fs.appendFileSync(logPath, `[${timestamp}] Overlay hooks: ${routeProfile.overlays.hooks.length} generated\n`);
  fs.appendFileSync(logPath, `[${timestamp}] Analysis time: ${routeProfile.metadata.analysisTime}ms\n`);
  
  // Make log file world-writable so Docker container can append to it
  try {
    fs.chmodSync(logPath, 0o666);
  } catch (e) {
    console.warn('Could not chmod log file:', e.message);
  }
}

/**
 * Save metadata files to output directory
 */
function saveMetadataFiles(routeProfile, renderConfig, outputDir) {
  const overlayDataPath = path.join(outputDir, 'overlay-data.json');
  const routeAnalysis = routeProfile.route;

  const metadata = {
    overlayHooks: routeProfile.overlays,
    routePattern: routeProfile.pattern,
    routeMetadata: {
      distance: routeAnalysis.distance,
      elevation: routeAnalysis.elevation,
      terrain: routeAnalysis.terrain,
      routeType: routeAnalysis.routeType,
      metadata: routeAnalysis.metadata
    },
    camera: routeProfile.camera,
    animationSpeed: renderConfig.animationSpeed,
    videoDuration: renderConfig.videoDurationSeconds,
    analysisTime: routeProfile.metadata.analysisTime,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(overlayDataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Build completion data for API response
 */
function buildCompletionData(renderConfig, validation, dockerResult, startTime) {
  const routeProfile = renderConfig.routeProfile;
  const routeAnalysis = renderConfig.routeAnalysis;

  return {
    success: true,
    videoUrl: `/output/${renderConfig.paths.outputId}/route-video.mp4`,
    outputId: renderConfig.paths.outputId,
    fileSize: validation.videoStats.size,
    animationSpeed: renderConfig.animationSpeed,
    videoDurationSeconds: renderConfig.videoDurationSeconds,
    routeDurationMinutes: renderConfig.routeDurationMinutes,
    videoWidth: parseInt(renderConfig.recording.width, 10),
    videoHeight: parseInt(renderConfig.recording.height, 10),
    routePattern: routeProfile.pattern,
    overlayHooks: routeProfile.overlays,
    routeMetadata: {
      distance: routeAnalysis.distance,
      elevation: routeAnalysis.elevation,
      terrain: routeAnalysis.terrain,
      routeType: routeAnalysis.routeType,
      metadata: routeAnalysis.metadata
    },
    camera: routeProfile.camera,
    analysisTime: routeProfile.metadata.analysisTime,
    renderTime: Date.now() - startTime,
    memoryStats: dockerResult.memoryStats,
    logsUrl: `/logs/${renderConfig.paths.outputId}`,
    logsTextUrl: `/logs/${renderConfig.paths.outputId}/text`
  };
}

/**
 * Log render completion summary
 */
function logCompletion(renderId, startTime, videoSize) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Render complete: ${renderId}`);
  console.log(`   Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
  console.log(`   Video size: ${(videoSize / 1024 / 1024).toFixed(2)}MB`);
  console.log(`${'='.repeat(80)}\n`);
}

module.exports = {
  logAnalysisResults,
  saveMetadataFiles,
  buildCompletionData,
  logCompletion
};
