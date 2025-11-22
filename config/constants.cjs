/**
 * Central configuration for all constants and magic numbers
 * Used across server and telegram bot
 */

module.exports = {
  // Docker container configuration
  DOCKER: {
    USER_ID: process.env.DOCKER_USER_ID || '1001',
    GROUP_ID: process.env.DOCKER_GROUP_ID || '1002',
    SHM_SIZE: '2g',
    DEFAULT_IMAGE: 'cesium-route-recorder',
    GPU_DEVICE: '/dev/dri/card0'
  },

  // Memory monitoring
  MEMORY: {
    CHECK_INTERVAL_MS: 30000, // Check every 30 seconds
    WARNING_THRESHOLD_MB: 1500, // Warn at 1.5GB
    CRITICAL_THRESHOLD_MB: 2000 // Critical at 2GB
  },

  // Video rendering settings
  RENDER: {
    VIDEO_BUFFER_SECONDS: 19, // Buffer time added to video duration
    PROGRESS_CHECK_INTERVAL_MS: 20000, // Progress updates every 20 seconds
    TIMEOUT_MS: 3600000, // 60 minute timeout for renders
    DEFAULT_FPS: 30,
    MAX_VIDEO_MINUTES: 10, // Maximum video length before adaptive speed kicks in
    TARGET_VIDEO_SECONDS: 37, // Target video duration for optimal playback
    DEFAULT_WIDTH: 464,
    DEFAULT_HEIGHT: 848
  },

  // Animation speed settings
  ANIMATION: {
    DEFAULT_SPEED: 2, // Default animation speed multiplier
    MIN_SPEED: 1,
    MAX_SPEED: 100,
    ADAPTIVE_BUFFER_MINUTES: 0.5 // Buffer when calculating adaptive speed
  },

  // Telegram bot settings
  TELEGRAM: {
    MAX_FILE_SIZE_MB: 50, // Telegram's file size limit for bots
    LOG_TRUNCATE_LENGTH: 4000, // Maximum log length for messages
    HISTORY_LIMIT: 10, // Number of routes to keep in history
    PROGRESS_UPDATE_INTERVAL_MS: 20000, // Progress update frequency
    STATUS_CHECK_TIMEOUT_MS: 5000 // Timeout for status checks
  },

  // Geographic calculations
  GEO: {
    EARTH_RADIUS_METERS: 6371000, // Earth radius for Haversine formula
    DEFAULT_WALKING_SPEED_KMH: 5 // Assumed walking speed for estimates
  },

  // File cleanup settings
  CLEANUP: {
    DEFAULT_AGE_DAYS: 7, // Delete renders older than 7 days
    CHECK_INTERVAL_HOURS: 24 // Run cleanup every 24 hours
  },

  // API settings
  API: {
    DEFAULT_PORT: 3000,
    LOG_TRIM_LENGTH: 8000 // Maximum length for API log responses
  }
};
