import * as Cesium from 'cesium';
import { RouteSegment, RoutePatternType } from '../types';
import { detectLoop, LoopAnalysis } from './loopDetector';

/**
 * Route Analysis for Camera Planning
 * Analyzes route geometry to detect segments (climbs, turns, etc.)
 */

const THRESHOLDS = {
  climb: 5, // degrees
  turn: 30, // degrees
  straightLength: 10 // points
};

/**
 * Analyze route and detect segments for camera planning
 */
export function analyzeRoute(positions: Cesium.Cartesian3[]): RouteSegment[] {
  if (positions.length < 3) {
    return [];
  }

  const segments: RouteSegment[] = [];

  for (let i = 1; i < positions.length - 1; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const next = positions[i + 1];

    // Detect elevation changes (climbs/descents)
    const elevationSegment = detectElevationChange(prev, curr, next, i);
    if (elevationSegment) {
      segments.push(elevationSegment);
    }

    // Detect turns
    const turnSegment = detectTurn(prev, curr, next, i);
    if (turnSegment) {
      segments.push(turnSegment);
    }
  }

  return segments;
}

/**
 * Detect climbs and descents
 */
function detectElevationChange(
  prev: Cesium.Cartesian3,
  curr: Cesium.Cartesian3,
  next: Cesium.Cartesian3,
  index: number
): RouteSegment | null {
  const currHeight = Cesium.Cartographic.fromCartesian(curr).height;
  const nextHeight = Cesium.Cartographic.fromCartesian(next).height;

  const heightDiff = nextHeight - currHeight;
  const distance = Cesium.Cartesian3.distance(curr, next);
  const elevationAngle = Math.atan2(heightDiff, distance) * (180 / Math.PI);

  if (Math.abs(elevationAngle) > THRESHOLDS.climb) {
    const type = elevationAngle > 0 ? 'climb' : 'descent';
    const intensity = Math.min(Math.abs(elevationAngle) / 45, 1); // 45° = max intensity

    return {
      type,
      startIndex: index - 1,
      endIndex: index + 1,
      intensity
    };
  }

  return null;
}

/**
 * Detect turns
 */
function detectTurn(
  prev: Cesium.Cartesian3,
  curr: Cesium.Cartesian3,
  next: Cesium.Cartesian3,
  index: number
): RouteSegment | null {
  const v1 = Cesium.Cartesian3.subtract(curr, prev, new Cesium.Cartesian3());
  const v2 = Cesium.Cartesian3.subtract(next, curr, new Cesium.Cartesian3());

  Cesium.Cartesian3.normalize(v1, v1);
  Cesium.Cartesian3.normalize(v2, v2);

  const dotProduct = Cesium.Cartesian3.dot(v1, v2);
  const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * (180 / Math.PI);

  if (angle > THRESHOLDS.turn) {
    const intensity = Math.min(angle / 90, 1); // 90° = max intensity

    return {
      type: 'turn',
      startIndex: index - 1,
      endIndex: index + 1,
      intensity
    };
  }

  return null;
}

/**
 * Auto-detect route pattern from positions
 * Returns the most likely pattern type based on route analysis
 */
export function detectRoutePattern(positions: Cesium.Cartesian3[]): {
  pattern: RoutePatternType;
  loopAnalysis?: LoopAnalysis;
} {
  if (positions.length < 3) {
    return { pattern: 'unknown' };
  }

  // First check for loop pattern
  const loopAnalysis = detectLoop(positions);
  if (loopAnalysis.isLoop && loopAnalysis.loopness > 0.6) {
    console.log(`🔄 Loop detected! Loopness: ${loopAnalysis.loopness.toFixed(2)}, Radius: ${(loopAnalysis.averageRadius / 1000).toFixed(1)}km`);
    return { pattern: 'loop_around_point', loopAnalysis };
  }

  // Check for elevation changes
  const elevationChanges = positions.map((pos, i) => {
    if (i === 0) return 0;
    const prev = Cesium.Cartographic.fromCartesian(positions[i - 1]);
    const curr = Cesium.Cartographic.fromCartesian(pos);
    return curr.height - prev.height;
  });

  const totalElevationGain = elevationChanges.filter(e => e > 0).reduce((sum, e) => sum + e, 0);
  const totalElevationLoss = Math.abs(elevationChanges.filter(e => e < 0).reduce((sum, e) => sum + e, 0));

  // Detect pattern based on elevation profile
  if (totalElevationGain > 500 && totalElevationLoss < 200) {
    return { pattern: 'technical_climb' };
  }

  if (totalElevationGain < 200 && totalElevationLoss < 200) {
    return { pattern: 'flat_approach' };
  }

  // Default to unknown
  return { pattern: 'unknown' };
}
