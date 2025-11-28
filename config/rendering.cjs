/**
 * Video rendering configuration and helper functions
 */

const CONSTANTS = require('./constants.cjs');

class RenderingConfig {
  constructor() {
    this.fps = CONSTANTS.RENDER.DEFAULT_FPS;
    this.width = CONSTANTS.RENDER.DEFAULT_WIDTH;
    this.height = CONSTANTS.RENDER.DEFAULT_HEIGHT;
    this.videoBufferSeconds = CONSTANTS.RENDER.VIDEO_BUFFER_SECONDS;
    this.maxVideoMinutes = CONSTANTS.RENDER.MAX_VIDEO_MINUTES;
  }

  /**
   * Calculate expected video duration
   * @param {number} routeDurationSeconds - Route duration in seconds
   * @param {number} animationSpeed - Animation speed multiplier
   * @returns {number} Expected video duration in seconds
   */
  calculateVideoDuration(routeDurationSeconds, animationSpeed) {
    if (!routeDurationSeconds || !animationSpeed) {
      return null;
    }
    return Math.ceil((routeDurationSeconds / animationSpeed) + this.videoBufferSeconds);
  }

  /**
   * Calculate video bitrate from file size and duration
   * @param {number} fileSizeBytes - File size in bytes
   * @param {number} videoDurationSeconds - Video duration in seconds
   * @returns {number} Bitrate in kbps
   */
  calculateBitrate(fileSizeBytes, videoDurationSeconds) {
    if (!fileSizeBytes || !videoDurationSeconds) {
      return null;
    }
    return Math.round((fileSizeBytes * 8) / (videoDurationSeconds * 1000));
  }

  /**
   * Format video duration as MM:SS
   * @param {number} durationSeconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  formatVideoDuration(durationSeconds) {
    if (!durationSeconds) return 'N/A';
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format route duration as Xh Ym or Xm
   * @param {number} durationMinutes - Duration in minutes
   * @returns {string} Formatted duration
   */
  formatRouteDuration(durationMinutes) {
    if (!durationMinutes) return 'N/A';
    const totalMinutes = parseFloat(durationMinutes);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Format file size in MB
   * @param {number} sizeBytes - Size in bytes
   * @returns {string} Formatted size with 2 decimal places
   */
  formatFileSize(sizeBytes) {
    if (!sizeBytes) return 'N/A';
    return (sizeBytes / 1024 / 1024).toFixed(2);
  }

  /**
   * Get recording settings from environment or defaults
   * @param {Object} overrides - Optional overrides for settings
   * @returns {Object} Recording settings
   */
  getRecordingSettings(overrides = {}) {
    return {
      fps: overrides.fps || process.env.RECORD_FPS || this.fps,
      width: overrides.width || process.env.RECORD_WIDTH || this.width,
      height: overrides.height || process.env.RECORD_HEIGHT || this.height
    };
  }

  /**
   * Estimate render time based on fixed video duration
   * Platform-agnostic: all videos are 20 seconds at 24fps = 480 frames
   * Based on actual measurements: ~2 seconds per frame with CDP on CPU
   * @param {number} routeDurationMinutes - Route duration in minutes (for display only)
   * @param {number} animationSpeed - Animation speed multiplier (ignored in new system)
   * @returns {Object} Estimation details
   */
  estimateRenderTime(routeDurationMinutes, animationSpeed) {
    // Platform-agnostic fixed values
    const TARGET_VIDEO_SECONDS = 20;  // All videos are 20 seconds
    const OUTPUT_FPS = 24;
    const TOTAL_FRAMES = TARGET_VIDEO_SECONDS * OUTPUT_FPS; // 960 frames

    // Recording duration is now fixed
    const recordingSeconds = TARGET_VIDEO_SECONDS;
    const recordingMinutes = recordingSeconds / 60;

    // CDP screenshot is much faster than canvas.toDataURL (~2s vs ~13s per frame)
    const SECONDS_PER_FRAME = 2;
    const captureSeconds = TOTAL_FRAMES * SECONDS_PER_FRAME;
    const captureMinutes = captureSeconds / 60;

    // Encoding is fast - about 10x real-time with libx264
    const encodingMinutes = recordingMinutes / 10;

    // Total with overhead (startup, Cesium loading, etc.)
    const overheadMinutes = 2;
    const totalMinutes = Math.ceil(captureMinutes + encodingMinutes + overheadMinutes);

    // Estimate file size (CRF 23 at 720x1280 ~ 1.3-1.5 MB/minute of video)
    const estimatedSizeMB = Math.ceil(recordingMinutes * 1.4);

    return {
      totalMinutes,
      captureMinutes: Math.ceil(captureMinutes),
      encodingMinutes: Math.ceil(encodingMinutes),
      recordingMinutes: recordingMinutes.toFixed(1),
      estimatedSizeMB,
      totalFrames: TOTAL_FRAMES
    };
  }

  /**
   * Get version info
   * @returns {Object} Version information
   */
  getVersionInfo() {
    const fs = require('fs');
    const path = require('path');

    try {
      const packagePath = path.join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

      // Get git commit if available
      let gitCommit = 'unknown';
      try {
        const { execSync } = require('child_process');
        gitCommit = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
      } catch (e) {}

      return {
        version: pkg.version || '0.1.0',
        commit: gitCommit,
        buildDate: new Date().toISOString().split('T')[0]
      };
    } catch (e) {
      return { version: '0.1.0', commit: 'unknown', buildDate: 'unknown' };
    }
  }
}

module.exports = new RenderingConfig();
