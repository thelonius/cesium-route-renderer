/**
 * TrailManager - Handles trail position tracking and gap detection
 * Extracted from useCesiumAnimation.ts preRenderListener
 */
import * as Cesium from 'cesium';
import { TrackPoint } from '../../types';

// Import constants
import constants from '../../../config/constants';
const { CAMERA } = constants;

export interface TrailState {
  positions: Cesium.Cartesian3[];
  lastAddedTime: Cesium.JulianDate | null;
}

export interface TrailManagerOptions {
  startTime: Cesium.JulianDate;
  animationSpeed: number;
  filteredPoints: TrackPoint[];
}

/**
 * Creates initial trail state
 */
export function createTrailState(): TrailState {
  return {
    positions: [],
    lastAddedTime: null,
  };
}

/**
 * Resets trail state to initial values
 */
export function resetTrailState(state: TrailState, startTime: Cesium.JulianDate): void {
  state.positions = [];
  state.lastAddedTime = Cesium.JulianDate.clone(startTime);
}

/**
 * Checks if enough time has passed to add a new trail point
 */
export function shouldAddTrailPoint(
  currentTime: Cesium.JulianDate,
  lastAddedTime: Cesium.JulianDate | null,
  hasExistingPoints: boolean
): boolean {
  if (!lastAddedTime) return true;

  const dt = Cesium.JulianDate.secondsDifference(currentTime, lastAddedTime);
  if (dt < CAMERA.TRAIL_ADD_INTERVAL_SECONDS && hasExistingPoints) {
    return false;
  }
  return true;
}

/**
 * Detects if there's a large spatial or temporal gap that should reset the trail
 */
export function detectTrailGap(
  currentPosition: Cesium.Cartesian3,
  lastPosition: Cesium.Cartesian3,
  timeDelta: number,
  animationSpeed: number
): { hasGap: boolean; gapType: 'distance' | 'time' | null; value: number } {
  const distance = Cesium.Cartesian3.distance(lastPosition, currentPosition);
  const GAP_THRESHOLD = 5000; // 5km

  // Scale threshold based on animation speed
  const speedMultiplier = animationSpeed || 2;
  const TIME_JUMP_THRESHOLD = Math.max(30, speedMultiplier / 2);

  if (distance > GAP_THRESHOLD) {
    return { hasGap: true, gapType: 'distance', value: distance };
  }

  if (Math.abs(timeDelta) > TIME_JUMP_THRESHOLD) {
    return { hasGap: true, gapType: 'time', value: timeDelta };
  }

  return { hasGap: false, gapType: null, value: 0 };
}

/**
 * Logs gap diagnostic information
 */
export function logGapDiagnostic(
  gapType: 'distance' | 'time',
  value: number,
  currentTime: Cesium.JulianDate,
  isDocker: boolean
): void {
  if (isDocker) return;

  if (gapType === 'distance') {
    try {
      console.log(`Large gap detected (${(value / 1000).toFixed(1)}km) at time ${Cesium.JulianDate.toIso8601(currentTime)}, resetting trail`);
    } catch (e) {
      console.log(`Large gap detected (${(value / 1000).toFixed(1)}km), resetting trail`);
    }
  } else if (gapType === 'time') {
    console.log(`Time jump detected (${value.toFixed(1)}s), resetting trail`);
  }
}

/**
 * Finds the nearest sample point to the current time for diagnostics
 */
export function findNearestSample(
  filteredPoints: TrackPoint[],
  currentTime: Cesium.JulianDate
): { index: number; point: TrackPoint | null; timeDiff: number } {
  let nearestIdx = -1;
  let nearestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < filteredPoints.length; i++) {
    try {
      const t = Cesium.JulianDate.fromIso8601(filteredPoints[i].time);
      const diff = Math.abs(Cesium.JulianDate.secondsDifference(t, currentTime));
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestIdx = i;
      }
    } catch (e) {}
  }

  return {
    index: nearestIdx,
    point: nearestIdx >= 0 ? filteredPoints[nearestIdx] : null,
    timeDiff: nearestDiff,
  };
}

/**
 * Logs nearest sample diagnostic information
 */
export function logNearestSampleDiagnostic(
  nearestSample: { index: number; point: TrackPoint | null; timeDiff: number },
  currentPosition: Cesium.Cartesian3
): void {
  if (nearestSample.index < 0 || !nearestSample.point) return;

  const np = nearestSample.point;
  const npPos = Cesium.Cartesian3.fromDegrees(
    Number(np.lon),
    Number(np.lat),
    Number(np.ele) || 0
  );
  const distToCurrent = Cesium.Cartesian3.distance(npPos, currentPosition);

  console.log(
    `Nearest sample idx=${nearestSample.index} time=${np.time} lat=${np.lat} lon=${np.lon} ele=${np.ele} (dt=${nearestSample.timeDiff}s) distToCurrent=${(distToCurrent / 1000).toFixed(3)}km`
  );
}

/**
 * Checks if trail reset is enabled via runtime flag
 */
export function isTrailResetEnabled(): boolean {
  return !!(window as any).__ENABLE_TRAIL_RESET;
}

/**
 * Checks if running in Docker environment
 */
export function isDockerEnvironment(): boolean {
  return new URLSearchParams(window.location.search).get('docker') === 'true';
}

/**
 * Main trail update function - processes a new frame and updates trail state
 */
export function updateTrail(
  state: TrailState,
  hikerEntity: Cesium.Entity,
  currentTime: Cesium.JulianDate,
  options: TrailManagerOptions
): void {
  const { startTime, animationSpeed, filteredPoints } = options;

  // Check for time going backwards (animation loop)
  if (state.lastAddedTime && Cesium.JulianDate.compare(currentTime, state.lastAddedTime) < 0) {
    if (isTrailResetEnabled()) {
      state.positions = [];
      state.lastAddedTime = Cesium.JulianDate.clone(startTime);
      return;
    } else {
      // Don't clear trail; just reset the lastAddedTime pointer
      state.lastAddedTime = Cesium.JulianDate.clone(startTime);
    }
  }

  // Get current position
  const currentPosition = hikerEntity.position?.getValue(currentTime);
  if (!currentPosition) return;

  // Check if we should add a point based on time interval
  if (!shouldAddTrailPoint(currentTime, state.lastAddedTime, state.positions.length > 0)) {
    return;
  }

  // Check for gaps
  if (state.positions.length > 0 && state.lastAddedTime) {
    const lastPosition = state.positions[state.positions.length - 1];
    const dt = Cesium.JulianDate.secondsDifference(currentTime, state.lastAddedTime);
    const gapResult = detectTrailGap(currentPosition, lastPosition, dt, animationSpeed);

    if (gapResult.hasGap && gapResult.gapType) {
      const isDocker = isDockerEnvironment();
      logGapDiagnostic(gapResult.gapType, gapResult.value, currentTime, isDocker);

      // Log nearest sample for debugging
      const nearestSample = findNearestSample(filteredPoints, currentTime);
      if (nearestSample.index >= 0) {
        logNearestSampleDiagnostic(nearestSample, currentPosition);
      }

      // Only reset trail if flag is enabled
      if (isTrailResetEnabled()) {
        state.positions = [];
      } else {
        console.log('Trail reset suppressed (window.__ENABLE_TRAIL_RESET is false)');
      }
    }
  }

  // Add the new position
  try {
    state.positions.push(currentPosition.clone());
  } catch (e) {
    console.warn('Failed to clone currentPosition for trail, skipping point:', e);
  }

  // Update last added time
  state.lastAddedTime = Cesium.JulianDate.clone(currentTime);
}
