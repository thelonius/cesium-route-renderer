import * as Cesium from 'cesium';

/**
 * Cesium Camera Service
 *
 * Provides advanced camera movement strategies for route visualization:
 * - Follow: Camera follows behind the moving entity (default)
 * - Cinematic: Dynamic camera angles based on route characteristics
 * - Bird's Eye: High-altitude overview with smooth transitions
 *
 * Integrates with route patterns to create compelling camera movements.
 */

export type CameraStrategy = 'follow' | 'cinematic' | 'birds-eye' | 'static';

export interface CameraSettings {
  strategy: CameraStrategy;
  followDistance: number; // meters
  followHeight: number; // meters
  lookAheadDistance: number; // meters
  smoothingFactor: number; // 0-1, higher = smoother
  enableTilt: boolean;
  enableRotation: boolean;
  minHeight: number; // meters
  maxHeight: number; // meters
}

export interface CameraKeyframe {
  timestamp: number; // seconds from start
  position: Cesium.Cartesian3;
  orientation?: {
    heading: number;
    pitch: number;
    roll: number;
  };
  strategy?: CameraStrategy;
  duration?: number; // seconds to interpolate to this keyframe
}

export interface RouteSegment {
  type: 'climb' | 'descent' | 'turn' | 'straight' | 'peak' | 'valley';
  startIndex: number;
  endIndex: number;
  intensity: number; // 0-1
}

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
 * Camera Service Class
 */
export class CesiumCameraService {
  private viewer: Cesium.Viewer;
  private settings: CameraSettings;
  private currentStrategy: CameraStrategy;
  private keyframes: CameraKeyframe[] = [];
  private routeSegments: RouteSegment[] = [];

  constructor(viewer: Cesium.Viewer, strategy: CameraStrategy = 'follow') {
    this.viewer = viewer;
    this.currentStrategy = strategy;
    this.settings = { ...DEFAULT_CAMERA_SETTINGS[strategy] };
  }

  /**
   * Update camera settings
   */
  updateSettings(settings: Partial<CameraSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.currentStrategy = this.settings.strategy;
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
  }

  /**
   * Analyze route and detect segments for camera planning
   */
  analyzeRoute(positions: Cesium.Cartesian3[]): RouteSegment[] {
    if (positions.length < 3) {
      return [];
    }

    const segments: RouteSegment[] = [];
    const threshold = {
      climb: 5, // degrees
      turn: 30, // degrees
      straightLength: 10 // points
    };

    for (let i = 1; i < positions.length - 1; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const next = positions[i + 1];

      // Calculate elevation change
      const prevHeight = Cesium.Cartographic.fromCartesian(prev).height;
      const currHeight = Cesium.Cartographic.fromCartesian(curr).height;
      const nextHeight = Cesium.Cartographic.fromCartesian(next).height;

      const heightDiff = nextHeight - currHeight;
      const distance = Cesium.Cartesian3.distance(curr, next);
      const elevationAngle = Math.atan2(heightDiff, distance) * (180 / Math.PI);

      // Detect climbs and descents
      if (Math.abs(elevationAngle) > threshold.climb) {
        const type = elevationAngle > 0 ? 'climb' : 'descent';
        const intensity = Math.min(Math.abs(elevationAngle) / 45, 1); // 45° = max intensity

        segments.push({
          type,
          startIndex: i - 1,
          endIndex: i + 1,
          intensity
        });
      }

      // Detect turns
      if (i > 0 && i < positions.length - 1) {
        const v1 = Cesium.Cartesian3.subtract(curr, prev, new Cesium.Cartesian3());
        const v2 = Cesium.Cartesian3.subtract(next, curr, new Cesium.Cartesian3());

        Cesium.Cartesian3.normalize(v1, v1);
        Cesium.Cartesian3.normalize(v2, v2);

        const dotProduct = Cesium.Cartesian3.dot(v1, v2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * (180 / Math.PI);

        if (angle > threshold.turn) {
          const intensity = Math.min(angle / 90, 1); // 90° = max intensity

          segments.push({
            type: 'turn',
            startIndex: i - 1,
            endIndex: i + 1,
            intensity
          });
        }
      }
    }

    this.routeSegments = segments;
    return segments;
  }

  /**
   * Generate camera keyframes based on route and strategy
   */
  generateKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[],
    segments?: RouteSegment[]
  ): CameraKeyframe[] {
    const keyframes: CameraKeyframe[] = [];
    const routeSegments = segments || this.routeSegments;

    switch (this.currentStrategy) {
      case 'follow':
        return this.generateFollowKeyframes(positions, times);

      case 'cinematic':
        return this.generateCinematicKeyframes(positions, times, routeSegments);

      case 'birds-eye':
        return this.generateBirdsEyeKeyframes(positions, times);

      case 'static':
        return this.generateStaticKeyframes(positions, times);

      default:
        return this.generateFollowKeyframes(positions, times);
    }
  }

  /**
   * Follow strategy: Camera follows behind entity
   */
  private generateFollowKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[]
  ): CameraKeyframe[] {
    const keyframes: CameraKeyframe[] = [];

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const nextPosition = positions[Math.min(i + 1, positions.length - 1)];

      // Calculate heading (direction of travel)
      const heading = this.calculateHeading(position, nextPosition);

      // Camera position: behind and above
      const cameraPosition = this.calculateCameraPosition(
        position,
        heading,
        this.settings.followDistance,
        this.settings.followHeight
      );

      // Look at point: ahead of entity
      const lookAtPosition = this.calculateLookAtPosition(
        position,
        heading,
        this.settings.lookAheadDistance
      );

      keyframes.push({
        timestamp: Cesium.JulianDate.secondsDifference(times[i], times[0]),
        position: cameraPosition,
        orientation: this.calculateOrientation(cameraPosition, lookAtPosition)
      });
    }

    this.keyframes = keyframes;
    return keyframes;
  }

  /**
   * Cinematic strategy: Dynamic angles based on route characteristics
   */
  private generateCinematicKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[],
    segments: RouteSegment[]
  ): CameraKeyframe[] {
    const keyframes: CameraKeyframe[] = [];

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const nextPosition = positions[Math.min(i + 1, positions.length - 1)];

      // Find active segment
      const activeSegment = segments.find(
        (seg) => i >= seg.startIndex && i <= seg.endIndex
      );

      // Adjust camera based on segment type
      let distanceMultiplier = 1.0;
      let heightMultiplier = 1.0;
      let pitchAdjustment = 0;

      if (activeSegment) {
        switch (activeSegment.type) {
          case 'climb':
            // Pull back and tilt up during climbs
            distanceMultiplier = 1.3;
            heightMultiplier = 1.2;
            pitchAdjustment = -10 * activeSegment.intensity;
            break;

          case 'descent':
            // Get closer and tilt down during descents
            distanceMultiplier = 0.8;
            heightMultiplier = 0.9;
            pitchAdjustment = 10 * activeSegment.intensity;
            break;

          case 'turn':
            // Swing wide on turns
            distanceMultiplier = 1.2;
            heightMultiplier = 1.1;
            break;
        }
      }

      const heading = this.calculateHeading(position, nextPosition);
      const distance = this.settings.followDistance * distanceMultiplier;
      const height = this.settings.followHeight * heightMultiplier;

      const cameraPosition = this.calculateCameraPosition(position, heading, distance, height);
      const lookAtPosition = this.calculateLookAtPosition(
        position,
        heading,
        this.settings.lookAheadDistance
      );

      const orientation = this.calculateOrientation(cameraPosition, lookAtPosition);
      orientation.pitch += pitchAdjustment * (Math.PI / 180);

      keyframes.push({
        timestamp: Cesium.JulianDate.secondsDifference(times[i], times[0]),
        position: cameraPosition,
        orientation
      });
    }

    this.keyframes = keyframes;
    return keyframes;
  }

  /**
   * Bird's Eye strategy: High-altitude overview
   */
  private generateBirdsEyeKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[]
  ): CameraKeyframe[] {
    const keyframes: CameraKeyframe[] = [];

    // Calculate route center and bounds
    const center = this.calculateCenter(positions);
    const bounds = this.calculateBounds(positions);
    const maxDimension = Math.max(bounds.width, bounds.height);

    // Camera height based on route size
    const height = Math.max(this.settings.minHeight, Math.min(maxDimension * 0.8, this.settings.maxHeight));

    // Single keyframe for bird's eye (camera doesn't move)
    const cameraCartographic = Cesium.Cartographic.fromCartesian(center);
    cameraCartographic.height = height;
    const cameraPosition = Cesium.Cartographic.toCartesian(cameraCartographic);

    keyframes.push({
      timestamp: 0,
      position: cameraPosition,
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
        roll: 0
      }
    });

    this.keyframes = keyframes;
    return keyframes;
  }

  /**
   * Static strategy: Fixed camera position
   */
  private generateStaticKeyframes(
    positions: Cesium.Cartesian3[],
    times: Cesium.JulianDate[]
  ): CameraKeyframe[] {
    const keyframes: CameraKeyframe[] = [];

    // Calculate route center
    const center = this.calculateCenter(positions);
    const bounds = this.calculateBounds(positions);

    // Position camera at optimal viewing angle
    const offset = Math.max(bounds.width, bounds.height) * 0.5;
    const heading = Math.PI / 4; // 45 degrees

    const cameraPosition = this.calculateCameraPosition(
      center,
      heading,
      offset,
      this.settings.followHeight
    );

    keyframes.push({
      timestamp: 0,
      position: cameraPosition,
      orientation: this.calculateOrientation(cameraPosition, center)
    });

    this.keyframes = keyframes;
    return keyframes;
  }

  /**
   * Calculate heading from one position to another
   */
  private calculateHeading(from: Cesium.Cartesian3, to: Cesium.Cartesian3): number {
    const fromCartographic = Cesium.Cartographic.fromCartesian(from);
    const toCartographic = Cesium.Cartographic.fromCartesian(to);

    const longitudeDiff = toCartographic.longitude - fromCartographic.longitude;
    const latitudeDiff = toCartographic.latitude - fromCartographic.latitude;

    return Math.atan2(longitudeDiff, latitudeDiff);
  }

  /**
   * Calculate camera position behind and above entity
   */
  private calculateCameraPosition(
    entityPosition: Cesium.Cartesian3,
    heading: number,
    distance: number,
    height: number
  ): Cesium.Cartesian3 {
    const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);

    // Move backwards (opposite of heading)
    const backwardHeading = heading + Math.PI;

    // Calculate offset
    const earthRadius = 6378137; // meters
    const deltaLat = (distance * Math.cos(backwardHeading)) / earthRadius;
    const deltaLon =
      (distance * Math.sin(backwardHeading)) / (earthRadius * Math.cos(cartographic.latitude));

    const cameraCartographic = new Cesium.Cartographic(
      cartographic.longitude + deltaLon,
      cartographic.latitude + deltaLat,
      cartographic.height + height
    );

    return Cesium.Cartographic.toCartesian(cameraCartographic);
  }

  /**
   * Calculate look-at position ahead of entity
   */
  private calculateLookAtPosition(
    entityPosition: Cesium.Cartesian3,
    heading: number,
    distance: number
  ): Cesium.Cartesian3 {
    const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);

    const earthRadius = 6378137;
    const deltaLat = (distance * Math.cos(heading)) / earthRadius;
    const deltaLon = (distance * Math.sin(heading)) / (earthRadius * Math.cos(cartographic.latitude));

    const lookAtCartographic = new Cesium.Cartographic(
      cartographic.longitude + deltaLon,
      cartographic.latitude + deltaLat,
      cartographic.height
    );

    return Cesium.Cartographic.toCartesian(lookAtCartographic);
  }

  /**
   * Calculate camera orientation (HPR) to look at target
   */
  private calculateOrientation(
    cameraPosition: Cesium.Cartesian3,
    targetPosition: Cesium.Cartesian3
  ): { heading: number; pitch: number; roll: number } {
    const direction = Cesium.Cartesian3.subtract(
      targetPosition,
      cameraPosition,
      new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.normalize(direction, direction);

    const up = Cesium.Cartesian3.normalize(cameraPosition, new Cesium.Cartesian3());

    // Calculate heading
    const east = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(east, east);

    const north = Cesium.Cartesian3.cross(up, east, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(north, north);

    const heading = Math.atan2(
      Cesium.Cartesian3.dot(direction, east),
      Cesium.Cartesian3.dot(direction, north)
    );

    // Calculate pitch
    const pitch =
      Math.asin(Cesium.Cartesian3.dot(direction, up)) - Cesium.Math.PI_OVER_TWO;

    return {
      heading,
      pitch,
      roll: 0
    };
  }

  /**
   * Calculate center of positions
   */
  private calculateCenter(positions: Cesium.Cartesian3[]): Cesium.Cartesian3 {
    const sum = positions.reduce(
      (acc, pos) => Cesium.Cartesian3.add(acc, pos, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(0, 0, 0)
    );

    return Cesium.Cartesian3.divideByScalar(sum, positions.length, new Cesium.Cartesian3());
  }

  /**
   * Calculate bounding box of positions
   */
  private calculateBounds(
    positions: Cesium.Cartesian3[]
  ): { width: number; height: number; depth: number } {
    const cartographics = positions.map((pos) => Cesium.Cartographic.fromCartesian(pos));

    const lons = cartographics.map((c) => c.longitude);
    const lats = cartographics.map((c) => c.latitude);
    const heights = cartographics.map((c) => c.height);

    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);

    const earthRadius = 6378137;
    const width = (maxLon - minLon) * earthRadius * Math.cos((minLat + maxLat) / 2);
    const height = (maxLat - minLat) * earthRadius;
    const depth = maxHeight - minHeight;

    return { width, height, depth };
  }

  /**
   * Apply camera keyframe at specific time
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

export default CesiumCameraService;
