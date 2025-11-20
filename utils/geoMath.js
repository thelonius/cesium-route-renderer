/**
 * Geographic math utilities
 * Calculations for distances, elevation, and route analysis
 */

const CONSTANTS = require('../config/constants');

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lon1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lon2 - Longitude of second point in degrees
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = CONSTANTS.GEO.EARTH_RADIUS_METERS;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Calculate total distance from an array of points
 * @param {Array<{lat: number, lon: number}>} points - Array of lat/lon points
 * @returns {number} Total distance in meters
 */
function calculateTotalDistance(points) {
  if (!points || points.length < 2) {
    return 0;
  }

  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineDistance(
      points[i-1].lat,
      points[i-1].lon,
      points[i].lat,
      points[i].lon
    );
  }

  return totalDistance;
}

/**
 * Parse track points from GPX content
 * @param {string} gpxContent - GPX file content
 * @returns {Array<{lat: number, lon: number}>} Array of points
 */
function parseTrackPoints(gpxContent) {
  const trkptMatches = gpxContent.match(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g);

  if (!trkptMatches) {
    return [];
  }

  return trkptMatches.map(match => {
    const latMatch = match.match(/lat="([^"]+)"/);
    const lonMatch = match.match(/lon="([^"]+)"/);
    return {
      lat: parseFloat(latMatch[1]),
      lon: parseFloat(lonMatch[1])
    };
  });
}

/**
 * Estimate route duration from distance using default walking speed
 * @param {number} distanceMeters - Distance in meters
 * @returns {number} Estimated duration in seconds
 */
function estimateDurationFromDistance(distanceMeters) {
  const distanceKm = distanceMeters / 1000;
  const walkingSpeed = CONSTANTS.GEO.DEFAULT_WALKING_SPEED_KMH;
  const durationHours = distanceKm / walkingSpeed;
  return durationHours * 3600; // Convert to seconds
}

/**
 * Calculate elevation gain from points with elevation data
 * @param {Array<{elevation: number}>} points - Array of points with elevation
 * @returns {Object} Elevation statistics
 */
function calculateElevationGain(points) {
  if (!points || points.length < 2) {
    return {
      gain: 0,
      loss: 0,
      minElevation: 0,
      maxElevation: 0
    };
  }

  let gain = 0;
  let loss = 0;
  let minElevation = points[0].elevation;
  let maxElevation = points[0].elevation;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].elevation;
    const curr = points[i].elevation;

    if (curr > prev) {
      gain += (curr - prev);
    } else {
      loss += (prev - curr);
    }

    if (curr < minElevation) minElevation = curr;
    if (curr > maxElevation) maxElevation = curr;
  }

  return {
    gain,
    loss,
    minElevation,
    maxElevation,
    totalChange: gain + loss
  };
}

/**
 * Estimate route type based on distance, duration, and elevation
 * This is a placeholder for future heuristics
 * @param {number} distanceMeters - Distance in meters
 * @param {number} durationSeconds - Duration in seconds
 * @param {Object} elevation - Elevation data (optional)
 * @returns {string} Route type ('hiking', 'cycling', 'driving', 'flying')
 */
function estimateRouteType(distanceMeters, durationSeconds, elevation = null) {
  if (!durationSeconds || durationSeconds === 0) {
    return 'unknown';
  }

  // Calculate average speed in km/h
  const distanceKm = distanceMeters / 1000;
  const durationHours = durationSeconds / 3600;
  const avgSpeedKmh = distanceKm / durationHours;

  // Simple classification based on speed
  if (avgSpeedKmh < 6) return 'hiking';
  if (avgSpeedKmh < 25) return 'cycling';
  if (avgSpeedKmh < 100) return 'driving';
  return 'flying';
}

/**
 * Determine terrain type from elevation data
 * This is a placeholder for future heuristics
 * @param {Object} elevation - Elevation statistics
 * @returns {string} Terrain type ('flat', 'hilly', 'mountainous')
 */
function classifyTerrain(elevation) {
  if (!elevation || !elevation.gain) {
    return 'flat';
  }

  // Simple classification based on elevation gain
  if (elevation.gain < 100) return 'flat';
  if (elevation.gain < 500) return 'hilly';
  return 'mountainous';
}

module.exports = {
  haversineDistance,
  calculateTotalDistance,
  parseTrackPoints,
  estimateDurationFromDistance,
  calculateElevationGain,
  estimateRouteType,
  classifyTerrain
};
