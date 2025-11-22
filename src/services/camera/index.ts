import * as Cesium from 'cesium';
import {
  CameraStrategy,
  CameraSettings,
  CameraKeyframe,
  RouteSegment,
  RoutePatternType
} from './types';
import { ICameraStrategy } from './strategies/ICameraStrategy';
import { FollowStrategy } from './strategies/FollowStrategy';
import { CinematicStrategy } from './strategies/CinematicStrategy';
import { BirdsEyeStrategy } from './strategies/BirdsEyeStrategy';
import { StaticStrategy } from './strategies/StaticStrategy';
import { getPatternAdjustment } from './patternAdjustments';
import { analyzeRoute } from './utils/routeAnalyzer';
import { getKeyframeAtTime } from './utils/keyframeInterpolator';

/**
 * Default camera settings for each strategy
 */
export const DEFAULT_CAMERA_SETTINGS: Record<CameraStrategy, CameraSettings> = {
  follow: {
    strategy: 'follow',
    followDistance: 50,
    followHeight: 30,
    lookAheadDistance: 20,
    smoothingFactor: 0.7,
    enableTilt: true,
    enableRotation: true,
    minHeight: 10,
    maxHeight: 500
  },
  cinematic: {
    strategy: 'cinematic',
    followDistance: 80,
    followHeight: 50,
    lookAheadDistance: 40,
    smoothingFactor: 0.85,
    enableTilt: true,
    enableRotation: true,
    minHeight: 20,
    maxHeight: 300
  },
  'birds-eye': {
    strategy: 'birds-eye',
    followDistance: 0,
    followHeight: 500,
    lookAheadDistance: 100,
    smoothingFactor: 0.9,
    enableTilt: false,
    enableRotation: false,
    minHeight: 300,
    maxHeight: 2000
  },
  static: {
    strategy: 'static',
    followDistance: 100,
    followHeight: 200,
    lookAheadDistance: 0,
    smoothingFactor: 0.95,
    enableTilt: false,
    enableRotation: false,
    minHeight: 100,
    maxHeight: 1000
  }
};

/**
 * Cesium Camera Service (Refactored)
 *
 * Orchestrates camera movement strategies for route visualization.
 * Delegates strategy-specific logic to strategy classes.
 */
export class CesiumCameraService {
  private viewer: Cesium.Viewer;
  private settings: CameraSettings;
  private currentStrategy: CameraStrategy;
  private strategyInstance: ICameraStrategy;
  private keyframes: CameraKeyframe[] = [];
  private routeSegments: RouteSegment[] = [];
  private routePattern: RoutePatternType = 'unknown';

  // Strategy instances (created on demand)
  private strategies: Map<CameraStrategy, ICameraStrategy> = new Map();

  constructor(viewer: Cesium.Viewer, strategy: CameraStrategy = 'follow') {
    this.viewer = viewer;
    this.currentStrategy = strategy;
    this.settings = { ...DEFAULT_CAMERA_SETTINGS[strategy] };

    // Initialize strategies
    this.strategies.set('follow', new FollowStrategy());
    this.strategies.set('cinematic', new CinematicStrategy());
    this.strategies.set('birds-eye', new BirdsEyeStrategy());
    this.strategies.set('static', new StaticStrategy());

    this.strategyInstance = this.strategies.get(strategy)!;
  }

  /**
   * Update camera settings
   */
  updateSettings(settings: Partial<CameraSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (settings.strategy && settings.strategy !== this.currentStrategy) {
      this.setStrategy(settings.strategy);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): CameraSettings {
    return { ...this.settings };
  }

  /**
   * Set camera strategy
   */
  setStrategy(strategy: CameraStrategy): void {
    this.currentStrategy = strategy;
    this.settings = { ...DEFAULT_CAMERA_SETTINGS[strategy] };
    this.strategyInstance = this.strategies.get(strategy)!;
  }

  /**
   * Set route pattern for camera adjustments
   */
  setRoutePattern(pattern: RoutePatternType): void {
    this.routePattern = pattern;
    console.log(`Camera: Route pattern set to ${pattern}`);
  }

  /**
   * Analyze route and detect segments for camera planning
   */
  analyzeRoute(positions: Cesium.Cartesian3[]): RouteSegment[] {
    this.routeSegments = analyzeRoute(positions);
    return this.routeSegments;
  }

  /**
   * Generate camera keyframes based on route and strategy
   */
  generateKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[],
    segments?: RouteSegment[]
  ): CameraKeyframe[] {
    const patternAdjustment = getPatternAdjustment(this.routePattern);

    this.keyframes = this.strategyInstance.generateKeyframes({
      positions,
      times,
      settings: this.settings,
      patternAdjustment,
      segments: segments || this.routeSegments
    });

    return this.keyframes;
  }

  /**
   * Apply camera keyframe
   */
  applyCameraKeyframe(keyframe: CameraKeyframe): void {
    if (!keyframe.orientation) {
      this.viewer.camera.position = keyframe.position;
      return;
    }

    this.viewer.camera.setView({
      destination: keyframe.position,
      orientation: {
        heading: keyframe.orientation.heading,
        pitch: keyframe.orientation.pitch,
        roll: keyframe.orientation.roll
      }
    });
  }

  /**
   * Apply camera at specific timestamp
   */
  applyCameraAtTime(timestamp: number): void {
    const keyframe = getKeyframeAtTime(this.keyframes, timestamp, this.settings);
    if (keyframe) {
      this.applyCameraKeyframe(keyframe);
    }
  }

  /**
   * Get keyframes
   */
  getKeyframes(): CameraKeyframe[] {
    return [...this.keyframes];
  }

  /**
   * Clear keyframes
   */
  clearKeyframes(): void {
    this.keyframes = [];
    this.routeSegments = [];
  }

  /**
   * Get route pattern
   */
  getRoutePattern(): RoutePatternType {
    return this.routePattern;
  }
}

/**
 * Create camera service instance
 */
export function createCameraService(
  viewer: Cesium.Viewer,
  strategy: CameraStrategy = 'follow'
): CesiumCameraService {
  return new CesiumCameraService(viewer, strategy);
}

// Re-export types for convenience
export * from './types';
export { PATTERN_CAMERA_ADJUSTMENTS } from './patternAdjustments';

export default CesiumCameraService;
