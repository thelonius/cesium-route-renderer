const gpxService = require('./gpxService');
const animationSpeedService = require('./animationSpeedService');

/**
 * Helper to extract numeric distance (in meters) from various formats
 * @param {Object|number} distance - Distance in various formats
 * @returns {number|null} Distance in meters, or null if not available
 */
function getDistanceMeters(distance) {
  if (distance == null) return null;
  if (typeof distance === 'number') return distance;
  if (typeof distance === 'object') {
    if (typeof distance.meters === 'number') return distance.meters;
    if (typeof distance.kilometers === 'number') return distance.kilometers * 1000;
    if (typeof distance.total === 'number') return distance.total;
  }
  return null;
}

/**
 * Route Analyzer Service
 *
 * High-level orchestrator that combines all route analysis services:
 * - GPX/KML parsing and route analysis
 * - Pattern detection (out-and-back, loop, multi-lap, etc.)
 * - Animation speed calculation
 * - Overlay hook generation
 * - Camera profile generation (Phase 6)
 *
 * Provides a single entry point for complete route analysis,
 * reducing complexity in server code and ensuring consistent data flow.
 */
class RouteAnalyzerService {
  constructor() {
    this.analysisCache = new Map(); // Cache analysis results
  }

  /**
   * Perform complete route analysis
   *
   * This is the main entry point that orchestrates all analysis steps:
   * 1. Parse GPX/KML and analyze route geometry
   * 2. Detect route patterns (out-and-back, loop, etc.)
   * 3. Calculate optimal animation speed
   * 4. Generate UI overlay hooks
   * 5. Generate camera profile (placeholder for Phase 6)
   *
   * @param {string} filePath - Path to GPX/KML file
   * @param {Object} settings - Application settings
   * @param {Object} options - Analysis options
   * @returns {Object} Complete route profile
   */
  analyzeComplete(filePath, settings, options = {}) {
    const startTime = Date.now();

    // Check cache if enabled
    const cacheKey = `${filePath}-${JSON.stringify(settings)}`;
    if (options.useCache && this.analysisCache.has(cacheKey)) {
      const cached = this.analysisCache.get(cacheKey);
      cached.fromCache = true;
      return cached;
    }

    // Step 1: Parse and analyze route geometry
    const routeAnalysis = gpxService.analyzeRoute(filePath);

    if (!routeAnalysis.success) {
      return {
        success: false,
        error: 'Failed to analyze route',
        details: routeAnalysis.error || 'Unknown error',
        analysisTime: Date.now() - startTime
      };
    }

    // Step 2: Detect route pattern
    const routePattern = animationSpeedService.detectRoutePattern(
      routeAnalysis,
      options.patternThresholds
    );

    // Step 3: Calculate animation speed
    const speedResult = animationSpeedService.calculateAdaptiveSpeed(
      routeAnalysis,
      settings
    );

    // Step 4: Generate overlay hooks for UI
    const overlayHooks = animationSpeedService.generateOverlayHooks(
      routeAnalysis,
      routePattern
    );

    // Step 5: Generate camera strategy
    const cameraStrategy = animationSpeedService.getCameraStrategyForPattern(
      routePattern,
      routeAnalysis
    );

    // Step 6: Generate camera profile (placeholder for Phase 6)
    const cameraProfile = this.generateCameraProfile(
      routeAnalysis,
      routePattern,
      speedResult,
      settings
    );

    // Compile complete profile
    const profile = {
      success: true,

      // Route geometry and metadata
      route: {
        points: routeAnalysis.points,
        distance: routeAnalysis.distance,
        duration: routeAnalysis.duration,
        elevation: routeAnalysis.elevation,
        terrain: routeAnalysis.terrain,
        routeType: routeAnalysis.routeType,
        metadata: routeAnalysis.metadata
      },

      // Pattern detection results
      pattern: {
        type: routePattern.pattern,
        basePattern: routePattern.basePattern || routePattern.pattern,
        confidence: routePattern.confidence,
        description: routePattern.reason,
        repetitions: routePattern.repetitions || 1,
        details: routePattern // Full pattern result
      },

      // Animation speed
      speed: {
        value: speedResult.speed,
        videoMinutes: speedResult.videoMinutes,
        reason: speedResult.adjustmentReason,
        suggested: speedResult.suggested
      },

      // UI overlays
      overlays: overlayHooks,

      // Camera configuration
      camera: {
        strategy: cameraStrategy,
        profile: cameraProfile,
        keyPoints: cameraStrategy.recommendations?.keyPoints || []
      },

      // Analysis metadata
      metadata: {
        analysisTime: Date.now() - startTime,
        filePath: filePath,
        fromCache: false,
        timestamp: new Date().toISOString()
      }
    };

    // Cache result if enabled
    if (options.useCache) {
      this.analysisCache.set(cacheKey, profile);

      // Clean old cache entries if cache gets too large
      if (this.analysisCache.size > 100) {
        const firstKey = this.analysisCache.keys().next().value;
        this.analysisCache.delete(firstKey);
      }
    }

    return profile;
  }

  /**
   * Analyze route and return only essentials (faster, less data)
   *
   * @param {string} filePath - Path to GPX/KML file
   * @param {Object} settings - Application settings
   * @returns {Object} Essential route information
   */
  analyzeEssentials(filePath, settings) {
    const routeAnalysis = gpxService.analyzeRoute(filePath);

    if (!routeAnalysis.success) {
      return {
        success: false,
        error: routeAnalysis.error
      };
    }

    const speedResult = animationSpeedService.calculateAdaptiveSpeed(
      routeAnalysis,
      settings
    );

    return {
      success: true,
      distance: routeAnalysis.distance,
      duration: routeAnalysis.duration,
      elevation: routeAnalysis.elevation,
      speed: speedResult.speed,
      videoMinutes: speedResult.videoMinutes
    };
  }

  /**
   * Get route statistics without full analysis
   * Useful for quick previews or validation
   *
   * @param {string} filePath - Path to GPX/KML file
   * @returns {Object} Route statistics
   */
  getRouteStats(filePath) {
    const routeAnalysis = gpxService.analyzeRoute(filePath);

    if (!routeAnalysis.success) {
      return {
        success: false,
        error: routeAnalysis.error
      };
    }

    return {
      success: true,
      pointCount: routeAnalysis.points?.length || 0,
      distance: routeAnalysis.distance,
      duration: routeAnalysis.duration,
      elevation: routeAnalysis.elevation,
      hasTimes: !!routeAnalysis.duration,
      hasElevation: !!routeAnalysis.elevation
    };
  }

  /**
   * Validate route file
   * Checks if file can be parsed and has minimum required data
   *
   * @param {string} filePath - Path to GPX/KML file
   * @returns {Object} Validation result
   */
  validateRoute(filePath) {
    const routeAnalysis = gpxService.analyzeRoute(filePath);

    const validation = {
      valid: routeAnalysis.success,
      errors: [],
      warnings: []
    };

    if (!routeAnalysis.success) {
      validation.errors.push(routeAnalysis.error || 'Failed to parse route file');
      return validation;
    }

    // Check minimum requirements
    if (!routeAnalysis.points || routeAnalysis.points.length < 2) {
      validation.valid = false;
      validation.errors.push('Route must have at least 2 points');
    }

    const distanceMeters = getDistanceMeters(routeAnalysis.distance);
    if (distanceMeters == null || distanceMeters < 1) {
      validation.warnings.push('Route distance is very short (< 1m)');
    }

    if (!routeAnalysis.duration) {
      validation.warnings.push('No timestamps found - duration estimated from distance');
    }

    if (!routeAnalysis.elevation) {
      validation.warnings.push('No elevation data found in route');
    }

    return validation;
  }

  /**
   * Generate camera profile (placeholder for Phase 6)
   * Will integrate with Cesium terrain and camera system
   *
   * @param {Object} routeAnalysis - Route analysis
   * @param {Object} routePattern - Pattern detection result
   * @param {Object} speedResult - Speed calculation result
   * @param {Object} settings - Camera settings
   * @returns {Object} Camera profile
   */
  generateCameraProfile(routeAnalysis, routePattern, speedResult, settings) {
    // PLACEHOLDER: Will be implemented in Phase 6
    // This will generate complete camera path with:
    // - Position interpolation along route
    // - Orientation based on terrain and pattern
    // - Speed modulation for key points
    // - LOS collision avoidance
    // - Smooth transitions

    const cameraSettings = settings.camera || {};

    return {
      enabled: cameraSettings.enabled || false,
      mode: 'follow-route', // Will support: follow-route, cinematic, orbit

      // Default camera parameters (will be overridden by terrain analysis)
      height: cameraSettings.defaultHeight || 150,
      tilt: cameraSettings.defaultTilt || 45,
      smoothingFactor: cameraSettings.smoothingFactor || 0.7,

      // Pattern-specific adjustments
      patternAdjustments: this.getCameraAdjustmentsForPattern(routePattern),

      // Placeholder for Phase 6
      segments: [], // Will contain per-segment camera parameters
      keyframes: [], // Will contain camera keyframes for smooth transitions

      note: 'Camera profile generation not fully implemented - Phase 6'
    };
  }

  /**
   * Get camera adjustments based on route pattern
   *
   * @param {Object} routePattern - Pattern detection result
   * @returns {Object} Camera adjustments
   */
  getCameraAdjustmentsForPattern(routePattern) {
    const adjustments = {
      heightMultiplier: 1.0,
      tiltAdjustment: 0,
      speedVariation: 'constant'
    };

    switch (routePattern.pattern) {
      case 'out-and-back':
      case 'repeated-out-and-back':
        adjustments.speedVariation = 'turnaround-slowdown';
        adjustments.tiltAdjustment = -5; // Look slightly down at turnaround
        break;

      case 'loop':
      case 'multi-lap':
        adjustments.heightMultiplier = 0.9; // Slightly lower for loops
        adjustments.speedVariation = 'consistent';
        break;

      case 'figure-eight':
        adjustments.speedVariation = 'intersection-slowdown';
        adjustments.heightMultiplier = 1.1; // Higher to see pattern
        break;

      case 'point-to-point':
        adjustments.speedVariation = 'start-end-slowdown';
        break;
    }

    // Terrain-based adjustments
    if (routePattern.details?.terrain === 'mountainous') {
      adjustments.heightMultiplier *= 1.3; // Higher camera in mountains
      adjustments.tiltAdjustment -= 10; // Look down more to show peaks
    }

    return adjustments;
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.analysisCache.size,
      keys: Array.from(this.analysisCache.keys())
    };
  }
}

// Export singleton instance
module.exports = new RouteAnalyzerService();
