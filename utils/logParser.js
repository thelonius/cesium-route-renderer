/**
 * Docker log parsing utilities
 * Extract progress, status, and metadata from Docker container logs
 */

/**
 * Parse recording progress from Docker logs
 * Looks for patterns like: "📹 Frame 90/900 (10.0%) | Animation: 3.0s | Elapsed: 180s | ETA: 1620s"
 * @param {string} logs - Docker log content
 * @returns {Object|null} Progress information or null if not found
 */
function parseRecordingProgress(logs) {
  if (!logs) return null;

  // Get the most recent frame update
  const lastFrameLog = logs.substring(logs.lastIndexOf('📹 Frame'));
  
  // New format with ETA
  const frameMatchWithETA = lastFrameLog.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)[^|]*\| ETA: (\d+)s/);
  if (frameMatchWithETA) {
    return {
      currentFrame: parseInt(frameMatchWithETA[1]),
      totalFrames: parseInt(frameMatchWithETA[2]),
      percentage: parseFloat(frameMatchWithETA[3]),
      etaSeconds: parseInt(frameMatchWithETA[4]),
      hasETA: true
    };
  }

  // Old format without ETA
  const frameMatch = lastFrameLog.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/);
  if (frameMatch) {
    return {
      currentFrame: parseInt(frameMatch[1]),
      totalFrames: parseInt(frameMatch[2]),
      percentage: parseFloat(frameMatch[3]),
      etaSeconds: null,
      hasETA: false
    };
  }

  return null;
}

/**
 * Parse encoding progress from Docker logs
 * Looks for FFmpeg output: "frame= 1440 fps= 62 q=-1.0 Lsize= 6890kB"
 * @param {string} logs - Docker log content
 * @returns {Object|null} Encoding information or null if not found
 */
function parseEncodingProgress(logs) {
  if (!logs) return null;

  const encodingMatch = logs.match(/frame=\s*(\d+)\s+fps=\s*([\d.]+)/);
  if (encodingMatch) {
    return {
      frame: parseInt(encodingMatch[1]),
      fps: parseFloat(encodingMatch[2])
    };
  }

  return null;
}

/**
 * Detect current stage from Docker logs
 * @param {string} logs - Docker log content
 * @returns {Object} Stage information
 */
function detectCurrentStage(logs) {
  if (!logs) {
    return { stage: 'unknown', message: 'No logs available' };
  }

  // Check stages in reverse chronological order (most recent first)
  if (logs.includes('Recording process complete') || logs.includes('🎉 Recording process complete')) {
    return { stage: 'complete', message: '✅ Complete' };
  }

  if (logs.includes('Video encoding completed') || logs.includes('✅ Video encoding complete')) {
    return { stage: 'encoding-done', message: '✅ Encoding complete' };
  }

  if (logs.includes('Starting video encoding')) {
    const encoding = parseEncodingProgress(logs);
    if (encoding) {
      return { 
        stage: 'encoding', 
        message: `🎬 Encoding video (frame ${encoding.frame}, ${encoding.fps} fps)`,
        details: encoding
      };
    }
    return { stage: 'encoding', message: '🎬 Encoding video' };
  }

  if (logs.includes('Recording completed')) {
    return { stage: 'finalizing', message: '📦 Finalizing recording' };
  }

  if (logs.includes('📹 Frame')) {
    const progress = parseRecordingProgress(logs);
    if (progress) {
      return {
        stage: 'recording',
        message: `📹 Recording ${progress.percentage.toFixed(0)}% (${progress.currentFrame}/${progress.totalFrames})`,
        details: progress
      };
    }
    return { stage: 'recording', message: '📹 Recording frames' };
  }

  if (logs.includes('✅ Test capture successful') || logs.includes('✅ Starting canvas frame capture')) {
    return { stage: 'recording-start', message: '📹 Starting frame recording' };
  }

  if (logs.includes('Recording progress:')) {
    // Old format fallback
    const progressMatch = logs.match(/Recording progress: (\d+)\/(\d+)s \((\d+)%\)/);
    if (progressMatch) {
      return {
        stage: 'recording',
        message: `📹 Recording ${progressMatch[3]}%`,
        details: {
          current: parseInt(progressMatch[1]),
          total: parseInt(progressMatch[2]),
          percentage: parseInt(progressMatch[3])
        }
      };
    }
  }

  if (logs.includes('Waiting for Cesium viewer to initialize') || logs.includes('Waiting for CESIUM_ANIMATION_READY')) {
    return { stage: 'loading', message: '🌍 Loading globe' };
  }

  if (logs.includes('Loading Cesium app') || logs.includes('Cesium app loaded')) {
    return { stage: 'initializing', message: '🌍 Loading Cesium' };
  }

  if (logs.includes('Starting canvas frame capture') || logs.includes('Running canvas-based frame capture')) {
    return { stage: 'ready', message: '🎬 Animation ready, starting capture' };
  }

  if (logs.includes('Running recording script')) {
    return { stage: 'script-start', message: '📝 Starting script' };
  }

  if (logs.includes('Starting Xvfb')) {
    return { stage: 'display-start', message: '🖥️ Starting display' };
  }

  if (logs.includes('Starting Docker container') || logs.includes('🐳 Starting Docker container')) {
    return { stage: 'docker-start', message: '🐳 Starting container' };
  }

  return { stage: 'initializing', message: '⏳ Initializing' };
}

/**
 * Extract animation speed from logs
 * @param {string} logs - Docker log content
 * @returns {number|null} Animation speed or null
 */
function extractAnimationSpeed(logs) {
  if (!logs) return null;

  const speedMatch = logs.match(/Animation speed: (\d+)x/);
  if (speedMatch) {
    return parseInt(speedMatch[1]);
  }

  return null;
}

/**
 * Extract expected video length from logs
 * @param {string} logs - Docker log content
 * @returns {string|null} Expected video length or null
 */
function extractExpectedVideoLength(logs) {
  if (!logs) return null;

  const durationMatch = logs.match(/Expected video length: ~([\d.]+) minutes/);
  if (durationMatch) {
    return durationMatch[1];
  }

  return null;
}

/**
 * Check if render has completed successfully
 * @param {string} logs - Docker log content
 * @returns {boolean} True if completed
 */
function isRenderComplete(logs) {
  if (!logs) return false;
  return logs.includes('Recording process complete') || logs.includes('🎉 Recording process complete');
}

/**
 * Check if render has failed
 * @param {string} logs - Docker log content
 * @returns {boolean} True if failed
 */
function isRenderFailed(logs) {
  if (!logs) return false;
  return logs.includes('Error:') || 
         logs.includes('Failed to') || 
         logs.includes('❌') ||
         logs.includes('FATAL');
}

/**
 * Extract error message from logs
 * @param {string} logs - Docker log content
 * @returns {string|null} Error message or null
 */
function extractErrorMessage(logs) {
  if (!logs) return null;

  // Look for common error patterns
  const errorPatterns = [
    /Error: (.+)/,
    /Failed to (.+)/,
    /❌ (.+)/,
    /FATAL: (.+)/
  ];

  for (const pattern of errorPatterns) {
    const match = logs.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Parse complete render status from logs
 * @param {string} logs - Docker log content
 * @returns {Object} Complete status information
 */
function parseRenderStatus(logs) {
  const stage = detectCurrentStage(logs);
  const progress = stage.stage === 'recording' ? parseRecordingProgress(logs) : null;
  const encoding = stage.stage === 'encoding' ? parseEncodingProgress(logs) : null;
  const animationSpeed = extractAnimationSpeed(logs);
  const expectedLength = extractExpectedVideoLength(logs);
  const isComplete = isRenderComplete(logs);
  const isFailed = isRenderFailed(logs);
  const errorMessage = isFailed ? extractErrorMessage(logs) : null;

  return {
    stage: stage.stage,
    message: stage.message,
    progress,
    encoding,
    animationSpeed,
    expectedLength,
    isComplete,
    isFailed,
    errorMessage
  };
}

module.exports = {
  parseRecordingProgress,
  parseEncodingProgress,
  detectCurrentStage,
  extractAnimationSpeed,
  extractExpectedVideoLength,
  isRenderComplete,
  isRenderFailed,
  extractErrorMessage,
  parseRenderStatus
};
