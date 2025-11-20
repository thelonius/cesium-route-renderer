/**
 * Video rendering configuration and helper functions
 */

const CONSTANTS = require('./constants');

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
   * Estimate render time based on route duration
   * Conservative estimate for software rendering
   * @param {number} routeDurationMinutes - Route duration in minutes
   * @param {number} animationSpeed - Animation speed multiplier
   * @returns {Object} Estimation details
   */
  estimateRenderTime(routeDurationMinutes, animationSpeed) {
    if (!routeDurationMinutes || !animationSpeed) {
      return null;
    }

    // Recording duration in minutes
    const recordingSeconds = (routeDurationMinutes * 60 / animationSpeed) + this.videoBufferSeconds;
    const recordingMinutes = recordingSeconds / 60;

    // Total frames at configured FPS
    const totalFrames = Math.ceil(recordingSeconds * this.fps);

    // Software rendering is slow - approximately 0.4-0.5 fps
    const FRAMES_PER_SECOND = 0.45; // Conservative estimate
    const captureMinutes = totalFrames / FRAMES_PER_SECOND / 60;

    // Encoding is faster - about 2-3x real-time
    const encodingMinutes = recordingMinutes * 2.5;

    // Total with overhead
    const overheadMinutes = 2; // Startup time
    const totalMinutes = Math.ceil(captureMinutes + encodingMinutes + overheadMinutes);

    // Estimate file size (CRF 20 at 1280x720 ~ 1-1.5 MB/minute)
    const estimatedSizeMB = Math.ceil(recordingMinutes * 1.3);

    return {
      totalMinutes,
      captureMinutes: Math.ceil(captureMinutes),
      encodingMinutes: Math.ceil(encodingMinutes),
      recordingMinutes: recordingMinutes.toFixed(1),
      estimatedSizeMB,
      totalFrames
    };
  }
}

module.exports = new RenderingConfig();
