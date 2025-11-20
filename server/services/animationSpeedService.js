const CONSTANTS = require('../../config/constants');
const { haversineDistance, calculateTotalDistance, calculateElevationGain } = require('../../utils/geoMath');

/**
 * Animation Speed Service
 * 
 * Manages animation speed calculations for route rendering with support for:
 * - Adaptive speed based on route duration
 * - Route pattern detection (point-to-point, out-and-back, loop)
 * - Terrain-aware speed adjustments
 * - Line-of-sight collision detection (future)
 * - Optimal camera orientation (future)
 * - Camera profile generation for smooth movements
 */
class AnimationSpeedService {
  constructor() {
    this.terrainCache = new Map(); // Cache for terrain samples
  }

  /**
   * Calculate adaptive animation speed for a route
   * 
   * @param {Object} routeAnalysis - Route analysis from gpxService
   * @param {Object} settings - Application settings
   * @returns {Object} { speed, videoMinutes, adjustmentReason, suggested }
   */
  calculateAdaptiveSpeed(routeAnalysis, settings) {
    const defaultSpeed = settings.animation.defaultSpeed;
    const maxVideoMinutes = settings.animation.maxVideoMinutes;
    const adaptiveEnabled = settings.animation.adaptiveSpeedEnabled;

    // If adaptive speed is disabled, return default
    if (!adaptiveEnabled) {
      return {
        speed: defaultSpeed,
        videoMinutes: null,
        adjustmentReason: 'Adaptive speed disabled',
        suggested: false
      };
    }

    // Check if we have valid duration
    if (!routeAnalysis.success || !routeAnalysis.duration) {
      return {
        speed: defaultSpeed,
        videoMinutes: null,
        adjustmentReason: 'No valid route duration',
        suggested: false
      };
    }

    const routeDurationMinutes = routeAnalysis.duration.minutes;
    const routeDurationSeconds = routeAnalysis.duration.seconds;

    // Calculate required speed to keep video under maxVideoMinutes
    const bufferMinutes = CONSTANTS.ANIMATION.ADAPTIVE_BUFFER_MINUTES;
    const requiredSpeed = Math.ceil(routeDurationMinutes / (maxVideoMinutes - bufferMinutes));

    let finalSpeed = defaultSpeed;
    let adjustmentReason = `Using default speed for ${routeDurationMinutes.toFixed(1)} min route`;

    if (requiredSpeed > defaultSpeed) {
      finalSpeed = requiredSpeed;
      adjustmentReason = `Route is long, increased speed to keep video under ${maxVideoMinutes} min`;
    }

    // Calculate expected video duration
    const videoSeconds = routeDurationSeconds / finalSpeed;
    const videoMinutes = videoSeconds / 60;

    return {
      speed: finalSpeed,
      videoMinutes: videoMinutes,
      adjustmentReason: adjustmentReason,
      suggested: requiredSpeed > defaultSpeed
    };
  }

  /**
   * Validate animation speed is within acceptable range
   * 
   * @param {number} speed - Speed to validate
   * @param {Object} settings - Application settings
   * @returns {Object} { valid, message, corrected }
   */
  validateSpeed(speed, settings) {
    const minSpeed = settings.animation.minSpeed || 0.5;
    const maxSpeed = settings.animation.maxSpeed || 100;

    if (speed < minSpeed) {
      return {
        valid: false,
        message: `Speed ${speed}x is below minimum ${minSpeed}x`,
        corrected: minSpeed
      };
    }

    if (speed > maxSpeed) {
      return {
        valid: false,
        message: `Speed ${speed}x exceeds maximum ${maxSpeed}x`,
        corrected: maxSpeed
      };
    }

    return {
      valid: true,
      message: 'Speed is valid',
      corrected: speed
    };
  }

  /**
   * Detect route pattern (point-to-point, out-and-back, loop, figure-eight)
   * 
   * @param {Object} routeAnalysis - Route analysis from gpxService
   * @param {Object} thresholds - Detection thresholds
   * @returns {Object} Pattern detection result
   */
  detectRoutePattern(routeAnalysis, thresholds = {}) {
    const defaults = {
      closeProximityMeters: 50,     // A to A' distance for loops/out-and-back
      pathOverlapPercent: 50,        // Threshold for out-and-back detection
      minLoopAreaMeters: 10000,      // Minimum area to consider a significant loop
      proximityCheckMeters: 10       // Distance threshold for path overlap
    };

    const config = { ...defaults, ...thresholds };

    // Extract points from route analysis
    const points = routeAnalysis.points || [];
    
    if (points.length < 2) {
      return {
        pattern: 'unknown',
        confidence: 0,
        reason: 'Insufficient points for analysis'
      };
    }

    const start = points[0];
    const end = points[points.length - 1];
    const startEndDistance = haversineDistance(
      start.lat, start.lon,
      end.lat, end.lon
    );

    // Check if route returns to start (loop or out-and-back)
    if (startEndDistance < config.closeProximityMeters) {
      const pathOverlap = this.calculatePathOverlap(points, config.proximityCheckMeters);
      
      if (pathOverlap > config.pathOverlapPercent) {
        // Out-and-back: significant path overlap
        const turnaroundPoint = this.findTurnaroundPoint(points);
        
        return {
          pattern: 'out-and-back',
          confidence: Math.min(pathOverlap / 100, 0.95),
          startEndDistance: startEndDistance,
          pathOverlap: pathOverlap,
          turnaroundPoint: turnaroundPoint,
          cameraStrategy: {
            outbound: 'forward-view',
            turnaround: 'dramatic-angle-change',
            return: 'alternate-angles'
          },
          reason: `${pathOverlap.toFixed(1)}% path overlap indicates retracing`
        };
      } else {
        // Loop: returns to start without retracing
        const enclosedArea = this.calculateEnclosedArea(points);
        const intersections = this.findIntersections(points, config.proximityCheckMeters);
        
        return {
          pattern: intersections.length > 2 ? 'figure-eight' : 'loop',
          confidence: Math.max(0.7, 1 - (pathOverlap / 100)),
          startEndDistance: startEndDistance,
          pathOverlap: pathOverlap,
          enclosedArea: enclosedArea,
          intersections: intersections.length,
          cameraStrategy: {
            general: 'continuous-forward',
            ending: 'show-completion',
            avoidLookback: true
          },
          reason: `Low overlap (${pathOverlap.toFixed(1)}%), circular route`
        };
      }
    } else {
      // Point-to-point: distinct start and end
      const routeDistance = routeAnalysis.distance || calculateTotalDistance(points);
      const linearityRatio = startEndDistance / routeDistance;
      
      return {
        pattern: 'point-to-point',
        confidence: Math.min(startEndDistance / 1000, 0.95),
        startEndDistance: startEndDistance,
        routeDistance: routeDistance,
        linearityRatio: linearityRatio,
        cameraStrategy: {
          beginning: 'establish-start',
          middle: 'progressive-journey',
          ending: 'arrival-sequence'
        },
        reason: `Start and end ${startEndDistance.toFixed(0)}m apart`
      };
    }
  }

  /**
   * Calculate percentage of path that overlaps with itself
   * Used to distinguish out-and-back from loop routes
   * 
   * @param {Array} points - Route points
   * @param {number} proximityMeters - Distance threshold for overlap
   * @returns {number} Percentage of overlapping path (0-100)
   */
  calculatePathOverlap(points, proximityMeters = 10) {
    if (points.length < 10) return 0;

    let overlapCount = 0;
    const midpoint = Math.floor(points.length / 2);
    
    // Compare first half with second half in reverse
    const firstHalf = points.slice(0, midpoint);
    const secondHalf = points.slice(midpoint).reverse();
    const compareLength = Math.min(firstHalf.length, secondHalf.length);

    for (let i = 0; i < compareLength; i++) {
      const p1 = firstHalf[i];
      const p2 = secondHalf[i];
      
      const distance = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
      
      if (distance < proximityMeters) {
        overlapCount++;
      }
    }

    return (overlapCount / compareLength) * 100;
  }

  /**
   * Find the furthest point from start (turnaround point)
   * 
   * @param {Array} points - Route points
   * @returns {Object} { index, point, distanceFromStart }
   */
  findTurnaroundPoint(points) {
    if (points.length < 2) return null;

    const start = points[0];
    let maxDistance = 0;
    let turnaroundIndex = 0;

    for (let i = 0; i < points.length; i++) {
      const distance = haversineDistance(
        start.lat, start.lon,
        points[i].lat, points[i].lon
      );
      
      if (distance > maxDistance) {
        maxDistance = distance;
        turnaroundIndex = i;
      }
    }

    return {
      index: turnaroundIndex,
      point: points[turnaroundIndex],
      distanceFromStart: maxDistance,
      percentageOfRoute: (turnaroundIndex / points.length) * 100
    };
  }

  /**
   * Find self-intersections in route
   * 
   * @param {Array} points - Route points
   * @param {number} proximityMeters - Distance threshold for intersection
   * @returns {Array} Array of intersection points
   */
  findIntersections(points, proximityMeters = 10) {
    const intersections = [];
    
    // Check each point against non-adjacent points
    for (let i = 0; i < points.length - 10; i++) {
      for (let j = i + 10; j < points.length; j++) {
        const distance = haversineDistance(
          points[i].lat, points[i].lon,
          points[j].lat, points[j].lon
        );
        
        if (distance < proximityMeters) {
          intersections.push({
            index1: i,
            index2: j,
            point: points[i],
            distance: distance
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Calculate area enclosed by route using Shoelace formula
   * 
   * @param {Array} points - Route points
   * @returns {number} Area in square meters (approximate)
   */
  calculateEnclosedArea(points) {
    if (points.length < 3) return 0;

    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].lon * points[j].lat;
      area -= points[j].lon * points[i].lat;
    }

    area = Math.abs(area) / 2;

    // Convert from degrees to approximate meters
    // This is a rough approximation, more accurate methods would use proper projection
    const metersPerDegree = 111320; // At equator
    area *= metersPerDegree * metersPerDegree;

    return area;
  }

  /**
   * Get camera strategy recommendations for route pattern
   * 
   * @param {Object} patternResult - Result from detectRoutePattern()
   * @param {Object} routeAnalysis - Full route analysis
   * @returns {Object} Camera strategy recommendations
   */
  getCameraStrategyForPattern(patternResult, routeAnalysis) {
    const strategy = patternResult.cameraStrategy || {};
    
    return {
      pattern: patternResult.pattern,
      recommendations: {
        ...strategy,
        speedAdjustments: this.getSpeedAdjustmentsForPattern(patternResult),
        keyPoints: this.getKeyPointsForPattern(patternResult, routeAnalysis)
      }
    };
  }

  /**
   * Get speed adjustment recommendations for pattern
   * 
   * @param {Object} patternResult - Pattern detection result
   * @returns {Object} Speed adjustment recommendations
   */
  getSpeedAdjustmentsForPattern(patternResult) {
    switch (patternResult.pattern) {
      case 'out-and-back':
        return {
          outbound: 1.0,
          turnaround: 0.5,  // Slow down at turnaround
          return: 1.2       // Can be faster on return (familiar terrain)
        };
      
      case 'loop':
      case 'figure-eight':
        return {
          general: 1.0,
          nearStart: 0.8    // Slow down near completion
        };
      
      case 'point-to-point':
        return {
          beginning: 0.8,   // Slow start to establish location
          middle: 1.0,
          ending: 0.7       // Slow ending for arrival
        };
      
      default:
        return { general: 1.0 };
    }
  }

  /**
   * Get key points for camera focus
   * 
   * @param {Object} patternResult - Pattern detection result
   * @param {Object} routeAnalysis - Route analysis
   * @returns {Array} Key points with camera recommendations
   */
  getKeyPointsForPattern(patternResult, routeAnalysis) {
    const keyPoints = [];

    if (patternResult.pattern === 'out-and-back' && patternResult.turnaroundPoint) {
      keyPoints.push({
        type: 'turnaround',
        index: patternResult.turnaroundPoint.index,
        action: 'dramatic-angle-change',
        speedMultiplier: 0.5
      });
    }

    if (patternResult.pattern === 'loop' || patternResult.pattern === 'figure-eight') {
      // Add start/end overlap zone
      keyPoints.push({
        type: 'completion',
        index: routeAnalysis.points.length - Math.floor(routeAnalysis.points.length * 0.05),
        action: 'show-approaching-start',
        speedMultiplier: 0.8
      });
    }

    return keyPoints;
  }

  // ============================================================================
  // TERRAIN-AWARE FEATURES (Placeholders for Phase 6)
  // ============================================================================

  /**
   * Calculate terrain complexity factor for speed adjustment
   * TODO: Implement with Cesium terrain provider in Phase 6
   * 
   * @param {Object} segment - Route segment
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {Object} { factor: 0.5-2.0, complexity: 'simple'|'moderate'|'complex' }
   */
  calculateTerrainComplexityFactor(segment, terrainProvider) {
    // PLACEHOLDER: Will analyze terrain variation, slope changes, feature density
    // Complex terrain = slower speed to show features
    // Flat terrain = faster speed
    return {
      factor: 1.0,
      complexity: 'unknown',
      note: 'Terrain analysis not yet implemented - requires Cesium integration'
    };
  }

  /**
   * Check line-of-sight between camera and target positions
   * TODO: Implement with Cesium terrain sampling in Phase 6
   * 
   * @param {Object} cameraPosition - { lat, lon, height }
   * @param {Object} targetPosition - { lat, lon, height }
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {Object} { clear: boolean, obstruction: point, clearanceMeters }
   */
  checkLineOfSight(cameraPosition, targetPosition, terrainProvider) {
    // PLACEHOLDER: Will ray-cast through terrain to check visibility
    // Uses Cesium.sampleTerrainMostDetailed() along ray path
    return {
      clear: true,
      obstruction: null,
      clearanceMeters: null,
      note: 'LOS checking not yet implemented - requires Cesium terrain sampling'
    };
  }

  /**
   * Get minimum safe camera height to avoid terrain collision
   * TODO: Implement with Cesium terrain sampling in Phase 6
   * 
   * @param {Object} position - { lat, lon }
   * @param {number} radius - Sample radius in meters
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {number} Minimum safe height in meters
   */
  getMinimumSafeHeight(position, radius, terrainProvider) {
    // PLACEHOLDER: Will sample terrain in radius and return max + clearance
    // Prevents camera from clipping through mountains/hills
    return 0; // Will return actual terrain height + safety margin
  }

  /**
   * Calculate optimal camera orientation based on local terrain
   * TODO: Implement with Cesium terrain analysis in Phase 6
   * 
   * @param {Object} position - { lat, lon, height }
   * @param {Object} terrainProvider - Cesium terrain provider
   * @param {number} routeDirection - Bearing in degrees
   * @returns {Object} { heading, pitch, roll, reason }
   */
  calculateOptimalOrientation(position, terrainProvider, routeDirection) {
    // PLACEHOLDER: Will analyze terrain in all directions
    // - Slope analysis for pitch adjustment
    // - Feature detection for interesting viewpoints
    // - Horizon visibility checks
    return {
      heading: routeDirection,
      pitch: -45,
      roll: 0,
      reason: 'Optimal orientation not yet implemented - using defaults'
    };
  }

  /**
   * Get terrain-aware camera profile for route segment
   * TODO: Implement with full terrain analysis in Phase 6
   * 
   * @param {Object} segment - Route segment with points
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {Object} Camera profile with orientation, height, speed
   */
  getTerrainAwareCameraProfile(segment, terrainProvider) {
    // PLACEHOLDER: Will generate complete camera profile
    // Examples:
    // - Ascending: Higher pitch, pull back to show climb
    // - Descending: Lower pitch, show valley ahead
    // - Flat with mountains: Pan to show peaks
    // - Canyon: Tilt to show walls
    return {
      height: 150,
      pitch: -45,
      heading: 0,
      speedMultiplier: 1.0,
      note: 'Terrain-aware profiles not yet implemented'
    };
  }

  /**
   * Identify scenic viewpoints along route
   * TODO: Implement with terrain visibility analysis in Phase 6
   * 
   * @param {Array} points - Route points
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {Array} Scenic viewpoints with scores
   */
  identifyScenicViewpoints(points, terrainProvider) {
    // PLACEHOLDER: Will analyze each point for scenic value
    // Based on: elevation prominence, visibility range, terrain variety
    // Camera should slow down or pause at high-scoring viewpoints
    return [];
  }

  /**
   * Generate complete camera path with all optimizations
   * TODO: Implement complete path generation in Phase 6
   * 
   * @param {Object} routeAnalysis - Route analysis from gpxService
   * @param {Object} settings - Camera settings
   * @param {Object} terrainProvider - Cesium terrain provider
   * @returns {Object} Complete camera path with positions, orientations, speeds
   */
  generateCameraPath(routeAnalysis, settings, terrainProvider) {
    // PLACEHOLDER: Will integrate all features:
    // - Route pattern detection
    // - Terrain complexity analysis
    // - LOS collision avoidance
    // - Optimal orientation calculation
    // - Scenic viewpoint identification
    // - Speed modulation per segment
    return {
      segments: [],
      keyPoints: [],
      totalDuration: 0,
      note: 'Camera path generation not yet implemented'
    };
  }
}

// Export singleton instance
module.exports = new AnimationSpeedService();
