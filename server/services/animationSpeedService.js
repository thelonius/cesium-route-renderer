const CONSTANTS = require('../../config/constants.cjs');
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
   * Detect route pattern including repeated/recursive patterns
   * Patterns: point-to-point, out-and-back, loop, figure-eight, multi-lap, repeated-segment
   *
   * @param {Object} routeAnalysis - Route analysis from gpxService
   * @param {Object} thresholds - Detection thresholds
   * @returns {Object} Pattern detection result with repetition info
   */
  detectRoutePattern(routeAnalysis, thresholds = {}) {
    const defaults = {
      closeProximityMeters: 50,     // A to A' distance for loops/out-and-back
      pathOverlapPercent: 50,        // Threshold for out-and-back detection
      minLoopAreaMeters: 10000,      // Minimum area to consider a significant loop
      proximityCheckMeters: 10,      // Distance threshold for path overlap
      minRepetitionLength: 20        // Minimum points for a repeated segment
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

    // First, check for repeated patterns (multi-lap or repeated segments)
    const repetitionAnalysis = this.detectRepeatedSegments(points, config);

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

        // Check if it's a repeated out-and-back
        if (repetitionAnalysis.hasRepetition && repetitionAnalysis.repetitionCount > 1) {
          return {
            pattern: 'repeated-out-and-back',
            basePattern: 'out-and-back',
            confidence: Math.min(pathOverlap / 100, 0.95),
            startEndDistance: startEndDistance,
            pathOverlap: pathOverlap,
            turnaroundPoint: turnaroundPoint,
            repetitions: repetitionAnalysis.repetitionCount,
            segmentLength: repetitionAnalysis.segmentLength,
            turnaroundPoints: repetitionAnalysis.keyPoints,
            cameraStrategy: {
              outbound: 'forward-view',
              turnaround: 'dramatic-angle-change',
              return: 'alternate-angles',
              repetition: 'vary-angles-per-lap'
            },
            reason: `${repetitionAnalysis.repetitionCount} repeated out-and-back segments with ${pathOverlap.toFixed(1)}% overlap`
          };
        }


        return {
          pattern: 'out-and-back',
          confidence: Math.min(pathOverlap / 100, 0.95),
          startEndDistance: startEndDistance,
          pathOverlap: pathOverlap,
          turnaroundPoint: turnaroundPoint,
          repetitions: 1,
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

        // Check if it's multiple laps of the same loop
        if (repetitionAnalysis.hasRepetition && repetitionAnalysis.repetitionCount > 1) {
          return {
            pattern: 'multi-lap',
            basePattern: 'loop',
            confidence: Math.max(0.7, 1 - (pathOverlap / 100)),
            startEndDistance: startEndDistance,
            pathOverlap: pathOverlap,
            enclosedArea: enclosedArea,
            intersections: intersections.length,
            laps: repetitionAnalysis.repetitionCount,
            lapLength: repetitionAnalysis.segmentLength,
            cameraStrategy: {
              general: 'continuous-forward',
              perLap: 'vary-height-and-angle',
              ending: 'show-completion',
              avoidLookback: true
            },
            reason: `${repetitionAnalysis.repetitionCount} laps of loop, ${enclosedArea.toFixed(0)}m² area`
          };
        }

        return {
          pattern: intersections.length > 2 ? 'figure-eight' : 'loop',
          confidence: Math.max(0.7, 1 - (pathOverlap / 100)),
          startEndDistance: startEndDistance,
          pathOverlap: pathOverlap,
          enclosedArea: enclosedArea,
          intersections: intersections.length,
          repetitions: 1,
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

      // Check for repeated segments in point-to-point (unusual but possible)
      if (repetitionAnalysis.hasRepetition) {
        return {
          pattern: 'repeated-segment',
          basePattern: 'point-to-point',
          confidence: Math.min(startEndDistance / 1000, 0.85),
          startEndDistance: startEndDistance,
          routeDistance: routeDistance,
          linearityRatio: linearityRatio,
          repetitions: repetitionAnalysis.repetitionCount,
          segmentLength: repetitionAnalysis.segmentLength,
          cameraStrategy: {
            beginning: 'establish-start',
            middle: 'progressive-journey',
            ending: 'arrival-sequence',
            repetition: 'vary-perspectives'
          },
          reason: `${repetitionAnalysis.repetitionCount} repeated segments, ends ${startEndDistance.toFixed(0)}m from start`
        };
      }

      return {
        pattern: 'point-to-point',
        confidence: Math.min(startEndDistance / 1000, 0.95),
        startEndDistance: startEndDistance,
        routeDistance: routeDistance,
        linearityRatio: linearityRatio,
        repetitions: 1,
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
   * Detect repeated segments in route (multi-lap or repeated out-and-back)
   *
   * @param {Array} points - Route points
   * @param {Object} config - Detection configuration
   * @returns {Object} { hasRepetition, repetitionCount, segmentLength, keyPoints }
   */
  detectRepeatedSegments(points, config) {
    if (points.length < config.minRepetitionLength * 2) {
      return { hasRepetition: false, repetitionCount: 1 };
    }

    // Strategy: Look for segments that repeat by comparing sequential portions
    // of the route for similarity

    const proximityMeters = config.proximityCheckMeters;
    const minSegmentLength = config.minRepetitionLength;

    // Try different segment lengths (from 10% to 40% of total route)
    const totalPoints = points.length;
    const maxSegmentLength = Math.floor(totalPoints * 0.4);

    let bestMatch = {
      hasRepetition: false,
      repetitionCount: 1,
      segmentLength: 0,
      keyPoints: [],
      matchScore: 0
    };

    for (let segmentLength = minSegmentLength; segmentLength < maxSegmentLength; segmentLength += 5) {
      const repetitions = Math.floor(totalPoints / segmentLength);

      if (repetitions < 2) continue;

      // Compare first segment with subsequent segments
      let totalMatches = 0;
      let totalComparisons = 0;
      const keyPoints = [0]; // Start of first segment

      for (let lap = 1; lap < repetitions; lap++) {
        const lapStart = lap * segmentLength;
        keyPoints.push(lapStart);

        let lapMatches = 0;
        const compareLength = Math.min(segmentLength, totalPoints - lapStart);

        for (let i = 0; i < compareLength; i += 3) { // Sample every 3rd point for performance
          const p1 = points[i];
          const p2 = points[lapStart + i];

          const distance = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);

          if (distance < proximityMeters * 2) { // Slightly relaxed for lap detection
            lapMatches++;
          }
          totalComparisons++;
        }

        totalMatches += lapMatches;
      }

      const matchScore = totalComparisons > 0 ? totalMatches / totalComparisons : 0;

      // If this segment length shows high repetition, record it
      if (matchScore > 0.6 && matchScore > bestMatch.matchScore) {
        bestMatch = {
          hasRepetition: true,
          repetitionCount: repetitions,
          segmentLength: segmentLength,
          keyPoints: keyPoints,
          matchScore: matchScore
        };
      }
    }

    return bestMatch;
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

      case 'repeated-out-and-back':
        return {
          outbound: 1.0,
          turnaround: 0.5,
          return: 1.2,
          perLap: [1.0, 1.1, 1.2], // Progressively faster on subsequent laps
          finalLap: 0.9     // Slow down on final lap
        };

      case 'loop':
      case 'figure-eight':
        return {
          general: 1.0,
          nearStart: 0.8    // Slow down near completion
        };

      case 'multi-lap':
        return {
          general: 1.0,
          perLap: [0.9, 1.0, 1.1], // First lap slower, subsequent faster
          nearStart: 0.8,
          finalLap: 0.85    // Slow final lap for completion
        };

      case 'point-to-point':
        return {
          beginning: 0.8,   // Slow start to establish location
          middle: 1.0,
          ending: 0.7       // Slow ending for arrival
        };

      case 'repeated-segment':
        return {
          beginning: 0.8,
          middle: 1.0,
          ending: 0.7,
          perRepetition: 1.1 // Slightly faster on repeated segments
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

    // Handle out-and-back patterns (single or repeated)
    if ((patternResult.pattern === 'out-and-back' || patternResult.pattern === 'repeated-out-and-back')
        && patternResult.turnaroundPoint) {

      if (patternResult.pattern === 'repeated-out-and-back' && patternResult.turnaroundPoints) {
        // Multiple turnaround points for repeated out-and-back
        patternResult.turnaroundPoints.forEach((pointIndex, lap) => {
          keyPoints.push({
            type: 'turnaround',
            lap: lap + 1,
            index: pointIndex,
            action: lap === 0 ? 'dramatic-angle-change' : 'quick-pivot',
            speedMultiplier: lap === 0 ? 0.5 : 0.7 // First turnaround slower
          });
        });
      } else {
        // Single turnaround
        keyPoints.push({
          type: 'turnaround',
          index: patternResult.turnaroundPoint.index,
          action: 'dramatic-angle-change',
          speedMultiplier: 0.5
        });
      }
    }

    // Handle loop patterns (single or multi-lap)
    if (patternResult.pattern === 'loop' || patternResult.pattern === 'figure-eight' || patternResult.pattern === 'multi-lap') {
      if (patternResult.pattern === 'multi-lap' && patternResult.laps > 1) {
        // Mark start of each lap
        const lapLength = patternResult.lapLength || Math.floor(routeAnalysis.points.length / patternResult.laps);

        for (let lap = 1; lap < patternResult.laps; lap++) {
          keyPoints.push({
            type: 'lap-start',
            lap: lap + 1,
            index: lap * lapLength,
            action: 'vary-camera-height',
            speedMultiplier: 1.0
          });
        }
      }

      // Add start/end overlap zone
      keyPoints.push({
        type: 'completion',
        index: routeAnalysis.points.length - Math.floor(routeAnalysis.points.length * 0.05),
        action: 'show-approaching-start',
        speedMultiplier: 0.8
      });
    }

    // Handle repeated segments in point-to-point
    if (patternResult.pattern === 'repeated-segment' && patternResult.segmentLength) {
      for (let i = 1; i < patternResult.repetitions; i++) {
        keyPoints.push({
          type: 'segment-repeat',
          repetition: i + 1,
          index: i * patternResult.segmentLength,
          action: 'vary-perspective',
          speedMultiplier: 1.0
        });
      }
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

  // ============================================================================
  // UI OVERLAY HOOKS (For Phase 5/6 - Overlay system)
  // ============================================================================

  /**
   * Generate UI overlay events/hooks based on route pattern and key points
   * These trigger overlays during video playback showing contextual information
   *
   * @param {Object} routeAnalysis - Route analysis from gpxService
   * @param {Object} patternResult - Pattern detection result
   * @returns {Object} Overlay configuration with triggers and content
   */
  generateOverlayHooks(routeAnalysis, patternResult) {
    const hooks = [];

    // Start location overlay (all routes)
    hooks.push({
      type: 'location-title',
      trigger: 'time',
      timeSeconds: 2, // Show 2 seconds into video
      duration: 5,
      priority: 'high',
      content: {
        title: routeAnalysis.metadata?.name || 'Route Start',
        subtitle: this.formatLocation(routeAnalysis.points[0]),
        description: routeAnalysis.metadata?.description || null
      },
      animation: 'fade-in-out',
      position: 'top-left'
    });

    // Pattern-specific overlays
    switch (patternResult.pattern) {
      case 'point-to-point':
        hooks.push(...this.generatePointToPointOverlays(routeAnalysis, patternResult));
        break;

      case 'out-and-back':
      case 'repeated-out-and-back':
        hooks.push(...this.generateOutAndBackOverlays(routeAnalysis, patternResult));
        break;

      case 'loop':
      case 'multi-lap':
      case 'figure-eight':
        hooks.push(...this.generateLoopOverlays(routeAnalysis, patternResult));
        break;
    }

    // Elevation-based overlays (peaks, valleys)
    if (routeAnalysis.elevation?.gain > 100) {
      hooks.push(...this.generateElevationOverlays(routeAnalysis));
    }

    // Segment stats overlays (every 25% of route)
    hooks.push(...this.generateSegmentStatsOverlays(routeAnalysis, patternResult));

    return {
      hooks: hooks.sort((a, b) => (a.timeSeconds || 0) - (b.timeSeconds || 0)),
      metadata: {
        totalOverlays: hooks.length,
        patterns: patternResult.pattern,
        hasElevationData: !!routeAnalysis.elevation,
        hasTimestamps: !!routeAnalysis.duration
      }
    };
  }

  /**
   * Generate overlays for point-to-point routes
   * Shows start, destination, and journey progress
   */
  generatePointToPointOverlays(routeAnalysis, patternResult) {
    const overlays = [];
    const points = routeAnalysis.points;

    // Destination preview at 90% completion
    overlays.push({
      type: 'destination-preview',
      trigger: 'progress',
      progressPercent: 90,
      duration: 8,
      priority: 'medium',
      content: {
        title: 'Approaching Destination',
        location: this.formatLocation(points[points.length - 1]),
        distance: `${patternResult.startEndDistance.toFixed(1)}m from start`
      },
      animation: 'slide-in-right',
      position: 'bottom-right'
    });

    return overlays;
  }

  /**
   * Generate overlays for out-and-back routes
   * Shows turnaround points and return progress
   */
  generateOutAndBackOverlays(routeAnalysis, patternResult) {
    const overlays = [];

    if (patternResult.pattern === 'repeated-out-and-back') {
      // Lap counter for repeated out-and-backs
      overlays.push({
        type: 'lap-counter',
        trigger: 'persistent',
        duration: 'full-video',
        priority: 'low',
        content: {
          currentLap: 1, // Will be updated dynamically
          totalLaps: patternResult.repetitions,
          lapTimes: [] // Populated during playback
        },
        animation: 'none',
        position: 'top-right',
        updateTriggers: patternResult.turnaroundPoints?.map(index => ({
          type: 'index',
          pointIndex: index,
          action: 'increment-lap'
        }))
      });
    }

    // Turnaround point overlay
    const turnaroundIndex = patternResult.turnaroundPoint?.index;
    if (turnaroundIndex) {
      const turnaroundPercent = (turnaroundIndex / routeAnalysis.points.length) * 100;

      overlays.push({
        type: 'turnaround-marker',
        trigger: 'progress',
        progressPercent: turnaroundPercent,
        duration: 6,
        priority: 'high',
        content: {
          title: 'Turnaround Point',
          distance: `${patternResult.turnaroundPoint.distanceFromStart.toFixed(1)}m from start`,
          message: 'Heading back'
        },
        animation: 'zoom-in',
        position: 'center'
      });
    }

    return overlays;
  }

  /**
   * Generate overlays for loop routes
   * Shows lap counter, completion progress, and loop stats
   */
  generateLoopOverlays(routeAnalysis, patternResult) {
    const overlays = [];

    if (patternResult.pattern === 'multi-lap') {
      // Persistent lap counter
      overlays.push({
        type: 'lap-counter',
        trigger: 'persistent',
        duration: 'full-video',
        priority: 'low',
        content: {
          currentLap: 1,
          totalLaps: patternResult.laps,
          lapTimes: [],
          bestLap: null // Updated after first lap
        },
        animation: 'none',
        position: 'top-right',
        updateTriggers: Array.from({ length: patternResult.laps - 1 }, (_, i) => ({
          type: 'progress',
          progressPercent: ((i + 1) / patternResult.laps) * 100,
          action: 'increment-lap'
        }))
      });

      // Lap completion overlays
      for (let lap = 1; lap < patternResult.laps; lap++) {
        overlays.push({
          type: 'lap-complete',
          trigger: 'progress',
          progressPercent: (lap / patternResult.laps) * 100,
          duration: 4,
          priority: 'medium',
          content: {
            title: `Lap ${lap} Complete`,
            message: `${patternResult.laps - lap} to go`
          },
          animation: 'flash',
          position: 'center'
        });
      }
    }

    // Loop completion overlay
    overlays.push({
      type: 'loop-complete',
      trigger: 'progress',
      progressPercent: 95,
      duration: 6,
      priority: 'high',
      content: {
        title: 'Completing Loop',
        area: `${patternResult.enclosedArea?.toFixed(0) || 'N/A'}m²`,
        distance: `${routeAnalysis.distance?.toFixed(1) || 'N/A'}km`
      },
      animation: 'fade-in',
      position: 'bottom-center'
    });

    return overlays;
  }

  /**
   * Generate overlays for elevation changes
   * Shows peaks, climbs, and elevation stats
   */
  generateElevationOverlays(routeAnalysis) {
    const overlays = [];

    // Find highest point
    const points = routeAnalysis.points;
    let highestPoint = points[0];
    let highestIndex = 0;

    points.forEach((point, index) => {
      if (point.ele && (!highestPoint.ele || point.ele > highestPoint.ele)) {
        highestPoint = point;
        highestIndex = index;
      }
    });

    // Peak overlay
    if (highestPoint.ele) {
      overlays.push({
        type: 'peak-marker',
        trigger: 'index',
        pointIndex: highestIndex,
        duration: 8,
        priority: 'high',
        content: {
          title: 'Highest Point',
          elevation: `${highestPoint.ele.toFixed(0)}m`,
          gain: `${routeAnalysis.elevation.gain.toFixed(0)}m climb`,
          location: this.formatLocation(highestPoint)
        },
        animation: 'scale-in',
        position: 'top-center'
      });
    }

    return overlays;
  }

  /**
   * Generate segment statistics overlays
   * Shows periodic stats updates (distance, speed, elevation)
   */
  generateSegmentStatsOverlays(routeAnalysis, patternResult) {
    const overlays = [];
    const segments = [25, 50, 75]; // Show stats at 25%, 50%, 75%

    segments.forEach(percent => {
      const segmentIndex = Math.floor((percent / 100) * routeAnalysis.points.length);
      const point = routeAnalysis.points[segmentIndex];

      overlays.push({
        type: 'segment-stats',
        trigger: 'progress',
        progressPercent: percent,
        duration: 5,
        priority: 'low',
        content: {
          title: `${percent}% Complete`,
          distance: `${((routeAnalysis.distance || 0) * (percent / 100)).toFixed(1)}km`,
          elevation: point?.ele ? `${point.ele.toFixed(0)}m` : null,
          // Placeholders for future features:
          calories: null, // TODO: Calculate based on distance, elevation, user weight
          avgSpeed: null, // TODO: Calculate from timestamps
          pace: null // TODO: Calculate from distance and time
        },
        animation: 'slide-in-bottom',
        position: 'bottom-left'
      });
    });

    return overlays;
  }

  /**
   * Format location for display
   */
  formatLocation(point) {
    if (!point) return 'Unknown';
    return `${point.lat.toFixed(5)}°, ${point.lon.toFixed(5)}°`;
  }

  /**
   * Generate overlay triggers for specific route events
   * TODO: Expand with more event types in Phase 5/6
   *
   * @param {Object} routeAnalysis - Route analysis
   * @param {Object} patternResult - Pattern result
   * @returns {Array} Event triggers for overlay system
   */
  generateOverlayTriggers(routeAnalysis, patternResult) {
    const triggers = [];

    // Start trigger
    triggers.push({
      event: 'route-start',
      timeSeconds: 0,
      data: {
        totalDistance: routeAnalysis.distance,
        totalDuration: routeAnalysis.duration?.minutes,
        pattern: patternResult.pattern
      }
    });

    // Key point triggers
    const keyPoints = this.getKeyPointsForPattern(patternResult, routeAnalysis);
    keyPoints.forEach(kp => {
      triggers.push({
        event: `key-point-${kp.type}`,
        pointIndex: kp.index,
        data: kp
      });
    });

    // End trigger
    triggers.push({
      event: 'route-end',
      timeSeconds: 'end',
      data: {
        pattern: patternResult.pattern,
        completed: true
      }
    });

    return triggers;
  }
}

// Export singleton instance
module.exports = new AnimationSpeedService();
