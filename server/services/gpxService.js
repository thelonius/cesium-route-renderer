/**
 * GPX/KML Service
 * Parses GPX and KML files, extracts route data, timestamps, elevations
 */

const fs = require('fs');
const geoMath = require('../../utils/geoMath.cjs');

class GpxService {
  /**
   * Detect file type from filename
   * @param {string} filename - Filename to check
   * @returns {string} File type: 'gpx', 'kml', or 'unknown'
   */
  detectFileType(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.kml')) return 'kml';
    if (lower.endsWith('.gpx')) return 'gpx';
    return 'unknown';
  }

  /**
   * Read and parse GPX/KML file
   * @param {string} filePath - Absolute path to file
   * @returns {Object} Parsed route data
   */
  parseFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileType = this.detectFileType(filePath);

      return {
        success: true,
        content,
        fileType,
        points: geoMath.parseTrackPoints(content),
        timestamps: this.extractTimestamps(content),
        elevations: this.extractElevations(content),
        metadata: this.extractMetadata(content, fileType)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract timestamps from GPX/KML content
   * Supports both <time> (GPX) and <when> (KML) tags
   * @param {string} content - File content
   * @returns {Array<Date>} Array of timestamp objects
   */
  extractTimestamps(content) {
    const timeMatches = content.match(/<time>([^<]+)<\/time>|<when>([^<]+)<\/when>/g);

    if (!timeMatches || timeMatches.length === 0) {
      return [];
    }

    return timeMatches.map(match => {
      const timeStr = match.replace(/<\/?(?:time|when)>/g, '');
      return new Date(timeStr);
    });
  }

  /**
   * Extract elevation data from track points
   * @param {string} content - File content
   * @returns {Array<number>} Array of elevations in meters
   */
  extractElevations(content) {
    // Match elevation tags within track points
    const eleMatches = content.match(/<ele>([^<]+)<\/ele>/g);

    if (!eleMatches) {
      return [];
    }

    return eleMatches.map(match => {
      const eleStr = match.replace(/<\/?ele>/g, '');
      return parseFloat(eleStr);
    });
  }

  /**
   * Extract metadata from GPX/KML file
   * @param {string} content - File content
   * @param {string} fileType - File type ('gpx' or 'kml')
   * @returns {Object} Metadata
   */
  extractMetadata(content, fileType) {
    const metadata = {
      name: null,
      description: null,
      creator: null
    };

    // Extract name
    const nameMatch = content.match(/<name>([^<]+)<\/name>/);
    if (nameMatch) {
      metadata.name = nameMatch[1];
    }

    // Extract description
    const descMatch = content.match(/<desc>([^<]+)<\/desc>|<description>([^<]+)<\/description>/);
    if (descMatch) {
      metadata.description = descMatch[1] || descMatch[2];
    }

    // Extract creator (GPX specific)
    if (fileType === 'gpx') {
      const creatorMatch = content.match(/creator="([^"]+)"/);
      if (creatorMatch) {
        metadata.creator = creatorMatch[1];
      }
    }

    return metadata;
  }

  /**
   * Calculate route duration from timestamps
   * @param {Array<Date>} timestamps - Array of timestamps
   * @returns {Object|null} Duration information
   */
  calculateDuration(timestamps) {
    if (!timestamps || timestamps.length < 2) {
      return null;
    }

    const firstTime = timestamps[0];
    const lastTime = timestamps[timestamps.length - 1];
    const durationMs = lastTime - firstTime;
    const durationSeconds = durationMs / 1000;
    const durationMinutes = durationSeconds / 60;

    // Check if duration is valid
    if (durationMinutes < 1 || durationMinutes < 0) {
      return null;
    }

    return {
      seconds: durationSeconds,
      minutes: durationMinutes,
      hours: durationMinutes / 60,
      firstTime,
      lastTime
    };
  }

  /**
   * Analyze complete route from file
   * Combines parsing with analysis for camera heuristics
   * @param {string} filePath - Absolute path to file
   * @returns {Object} Complete route analysis
   */
  analyzeRoute(filePath) {
    const parsed = this.parseFile(filePath);

    if (!parsed.success) {
      return parsed;
    }

    // Calculate distance
    const distance = geoMath.calculateTotalDistance(parsed.points);

    // Calculate duration from timestamps
    let duration = this.calculateDuration(parsed.timestamps);

    // If no timestamps, estimate from distance
    if (!duration && distance > 0) {
      const estimatedSeconds = geoMath.estimateDurationFromDistance(distance);
      duration = {
        seconds: estimatedSeconds,
        minutes: estimatedSeconds / 60,
        hours: estimatedSeconds / 3600,
        estimated: true
      };
    }

    // Calculate elevation if available
    let elevation = null;
    if (parsed.elevations && parsed.elevations.length > 0) {
      const pointsWithElevation = parsed.points.map((point, i) => ({
        ...point,
        elevation: parsed.elevations[i] || 0
      }));
      elevation = geoMath.calculateElevationGain(pointsWithElevation);
    }

    // Classify route type
    const routeType = duration
      ? geoMath.estimateRouteType(distance, duration.seconds, elevation)
      : 'unknown';

    // Classify terrain
    const terrain = elevation
      ? geoMath.classifyTerrain(elevation)
      : 'unknown';

    return {
      success: true,
      fileType: parsed.fileType,
      metadata: parsed.metadata,
      pointCount: parsed.points.length,
      distance: {
        meters: distance,
        kilometers: distance / 1000
      },
      duration,
      elevation,
      routeType,
      terrain,
      hasTimestamps: parsed.timestamps.length > 0,
      hasElevation: parsed.elevations.length > 0
    };
  }
}

module.exports = new GpxService();
