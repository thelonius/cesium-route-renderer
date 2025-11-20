/**
 * Formatting utilities for durations, file sizes, and display
 */

/**
 * Format duration in seconds to MM:SS
 * @param {number} durationSeconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "3:45")
 */
function formatVideoDuration(durationSeconds) {
  if (!durationSeconds || isNaN(durationSeconds)) {
    return 'N/A';
  }
  
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.floor(durationSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format duration in minutes to Xh Ym or Xm
 * @param {number} durationMinutes - Duration in minutes
 * @returns {string} Formatted duration (e.g., "2h 34m" or "45m")
 */
function formatRouteDuration(durationMinutes) {
  if (!durationMinutes || isNaN(durationMinutes)) {
    return 'N/A';
  }
  
  const totalMinutes = Math.round(parseFloat(durationMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format file size in bytes to MB with decimals
 * @param {number} sizeBytes - Size in bytes
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted size (e.g., "15.23 MB")
 */
function formatFileSize(sizeBytes, decimals = 2) {
  if (!sizeBytes || isNaN(sizeBytes)) {
    return 'N/A';
  }
  
  const sizeMB = sizeBytes / 1024 / 1024;
  return `${sizeMB.toFixed(decimals)} MB`;
}

/**
 * Format file size in bytes to human-readable format with appropriate unit
 * @param {number} sizeBytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 GB", "234 MB", "12 KB")
 */
function formatFileSizeAuto(sizeBytes) {
  if (!sizeBytes || isNaN(sizeBytes)) {
    return 'N/A';
  }
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = sizeBytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

/**
 * Format bitrate in kbps
 * @param {number} fileSizeBytes - File size in bytes
 * @param {number} videoDurationSeconds - Video duration in seconds
 * @returns {string} Formatted bitrate (e.g., "2100 kbps")
 */
function formatBitrate(fileSizeBytes, videoDurationSeconds) {
  if (!fileSizeBytes || !videoDurationSeconds || isNaN(fileSizeBytes) || isNaN(videoDurationSeconds)) {
    return 'N/A';
  }
  
  const bitrateKbps = Math.round((fileSizeBytes * 8) / (videoDurationSeconds * 1000));
  return `${bitrateKbps} kbps`;
}

/**
 * Format distance in meters to human-readable format
 * @param {number} distanceMeters - Distance in meters
 * @returns {string} Formatted distance (e.g., "2.5 km" or "450 m")
 */
function formatDistance(distanceMeters) {
  if (!distanceMeters || isNaN(distanceMeters)) {
    return 'N/A';
  }
  
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

/**
 * Format elevation gain/loss
 * @param {number} elevationMeters - Elevation in meters
 * @returns {string} Formatted elevation (e.g., "+234 m")
 */
function formatElevation(elevationMeters) {
  if (elevationMeters === null || elevationMeters === undefined || isNaN(elevationMeters)) {
    return 'N/A';
  }
  
  const sign = elevationMeters >= 0 ? '+' : '';
  return `${sign}${Math.round(elevationMeters)} m`;
}

/**
 * Format speed in km/h
 * @param {number} speedKmh - Speed in km/h
 * @returns {string} Formatted speed (e.g., "5.2 km/h")
 */
function formatSpeed(speedKmh) {
  if (!speedKmh || isNaN(speedKmh)) {
    return 'N/A';
  }
  
  return `${speedKmh.toFixed(1)} km/h`;
}

/**
 * Format timestamp to readable date/time
 * @param {number|Date} timestamp - Timestamp in ms or Date object
 * @param {string} locale - Locale string (default: 'en-US')
 * @returns {string} Formatted date/time
 */
function formatTimestamp(timestamp, locale = 'en-US') {
  if (!timestamp) {
    return 'N/A';
  }
  
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Truncate string to maximum length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncateString(str, maxLength) {
  if (!str || str.length <= maxLength) {
    return str;
  }
  
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format percentage
 * @param {number} value - Value (0-100)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage (e.g., "45.5%")
 */
function formatPercentage(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }
  
  return `${value.toFixed(decimals)}%`;
}

module.exports = {
  formatVideoDuration,
  formatRouteDuration,
  formatFileSize,
  formatFileSizeAuto,
  formatBitrate,
  formatDistance,
  formatElevation,
  formatSpeed,
  formatTimestamp,
  truncateString,
  formatPercentage
};
