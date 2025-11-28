import * as Cesium from 'cesium';
import { getLazyCameraTarget } from '../../services/camera/utils/loopDetector';
import { getCameraValue } from '../../services/camera/runtimeConstants';
import constants from '../../../config/constants';

const { CAMERA } = constants;

export interface CameraState {
  smoothedHikerPosition: Cesium.Cartesian3 | null;
  smoothedCameraTarget: Cesium.Cartesian3 | null;
  lookAheadTarget: Cesium.Cartesian3 | null;
  currentRotationAngle: number | undefined;
  continuousAzimuth: number;
  cameraTiltProgress: number;
}

export interface LoopInfo {
  isLoop: boolean;
  centroid: Cesium.Cartesian3 | null;
  radius: number;
}

export interface CameraUpdateInputs {
  viewer: Cesium.Viewer;
  hikerEntity: Cesium.Entity;
  currentTime: Cesium.JulianDate;
  startTime: Cesium.JulianDate;
  stopTime: Cesium.JulianDate;
  loopInfo: LoopInfo;
  state: CameraState;
}

export interface CameraUpdateResult {
  position: Cesium.Cartesian3;
  lookAtTarget: Cesium.Cartesian3;
  lookAtOffset: Cesium.Cartesian3;
  newState: Partial<CameraState>;
}

/**
 * Computes camera position and orientation for tracking a hiker along a route.
 * Handles smoothing, look-ahead, loop route centroid blending, and azimuth rotation.
 */
export function computeCameraUpdate(inputs: CameraUpdateInputs): CameraUpdateResult | null {
  const { viewer, hikerEntity, currentTime, startTime, stopTime, loopInfo, state } = inputs;

  if (!hikerEntity.position) return null;

  const position = hikerEntity.position.getValue(currentTime);
  if (!position || !position.x || !Cesium.Cartesian3.equals(position, position)) {
    return null;
  }

  // Apply smoothing to hiker position
  const hikerSmoothAlpha = getCameraValue('HIKER_POSITION_SMOOTH_ALPHA', CAMERA.HIKER_POSITION_SMOOTH_ALPHA);
  let smoothedHikerPos: Cesium.Cartesian3;
  if (!state.smoothedHikerPosition) {
    smoothedHikerPos = Cesium.Cartesian3.clone(position);
  } else {
    smoothedHikerPos = Cesium.Cartesian3.lerp(
      state.smoothedHikerPosition,
      position,
      hikerSmoothAlpha,
      new Cesium.Cartesian3()
    );
  }

  // Calculate route progress
  const totalDuration = Cesium.JulianDate.secondsDifference(stopTime, startTime);
  const elapsed = Cesium.JulianDate.secondsDifference(currentTime, startTime);
  const routeProgress = Math.max(0, Math.min(1, elapsed / totalDuration));

  // Calculate look-ahead position
  const baseLookAhead = loopInfo.isLoop ? 15 : 10;
  const lookAheadSeconds = baseLookAhead * (1 - routeProgress * 0.7);
  const lookAheadTime = Cesium.JulianDate.addSeconds(currentTime, lookAheadSeconds, new Cesium.JulianDate());
  const lookAheadStopTime = viewer.clock.stopTime || stopTime;
  const clampedLookAheadTime = Cesium.JulianDate.compare(lookAheadTime, lookAheadStopTime) > 0
    ? lookAheadStopTime
    : lookAheadTime;

  const lookAheadPosition = hikerEntity.position.getValue(clampedLookAheadTime) || position;

  // Smooth look-ahead target
  const smoothedLookAhead = getLazyCameraTarget(
    lookAheadPosition,
    state.lookAheadTarget,
    40,
    0.80
  );

  // Smooth camera target position
  const baseThreshold = loopInfo.isLoop ? 15 : 25;
  const lateralThreshold = baseThreshold * (1 - routeProgress * 0.6);
  const positionSmoothness = 0.70 + routeProgress * 0.15;

  const smoothedPosition = getLazyCameraTarget(
    smoothedHikerPos,
    state.smoothedCameraTarget,
    lateralThreshold,
    positionSmoothness
  );

  // Blend look-ahead with centroid for loop routes
  let cameraLookAtTarget = smoothedLookAhead;
  if (loopInfo.isLoop && loopInfo.centroid) {
    const centroidWeight = 0.3 * (1 - routeProgress);
    cameraLookAtTarget = Cesium.Cartesian3.lerp(
      smoothedLookAhead,
      loopInfo.centroid,
      centroidWeight,
      new Cesium.Cartesian3()
    );
  }

  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(smoothedPosition);

  // Calculate azimuth rotation
  let azimuthRotation = 0;
  let newRotationAngle = state.currentRotationAngle;

  if (loopInfo.isLoop && loopInfo.centroid) {
    const vectorFromCentroid = Cesium.Cartesian3.subtract(
      smoothedPosition,
      loopInfo.centroid,
      new Cesium.Cartesian3()
    );
    const targetRotation = Math.atan2(vectorFromCentroid.y, vectorFromCentroid.x) * (180 / Math.PI);

    if (newRotationAngle === undefined) {
      newRotationAngle = targetRotation;
    }

    let angleDiff = targetRotation - newRotationAngle;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    const azimuthSmoothing = getCameraValue('SMOOTH_ALPHA', CAMERA.SMOOTH_ALPHA || 0.15);
    const azimuthMultiplier = getCameraValue('AZIMUTH_MULTIPLIER', CAMERA.AZIMUTH_MULTIPLIER || 1.0);
    azimuthRotation = newRotationAngle + (angleDiff * azimuthMultiplier) * azimuthSmoothing;
    newRotationAngle = azimuthRotation;
  }

  // Calculate camera offset
  let cameraOffsetDistance = CAMERA.BASE_BACK;
  let cameraOffsetHeight = CAMERA.BASE_HEIGHT;

  if (loopInfo.isLoop && loopInfo.centroid) {
    cameraOffsetDistance = Math.min(loopInfo.radius * 1.5, CAMERA.BASE_BACK * 2);
    cameraOffsetHeight = CAMERA.BASE_HEIGHT;
  }

  // Apply azimuth rotation
  const combinedAzimuth = azimuthRotation + (state.continuousAzimuth || 0);
  const baseAzimuthRadians = Cesium.Math.toRadians(combinedAzimuth);
  const rotatedOffsetX = -cameraOffsetDistance * Math.cos(baseAzimuthRadians);
  const rotatedOffsetY = -cameraOffsetDistance * Math.sin(baseAzimuthRadians);

  const cameraOffsetLocal = new Cesium.Cartesian3(rotatedOffsetX, rotatedOffsetY, cameraOffsetHeight);
  const cameraPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3());

  if (!cameraPosition || !Cesium.Cartesian3.equals(cameraPosition, cameraPosition)) {
    return null;
  }

  // Calculate lookAt offset with tilt interpolation
  const lookX = getCameraValue('OFFSET_LOOKAT_X_RATIO', CAMERA.OFFSET_LOOKAT_X_RATIO || 0.8);
  const lookZ = getCameraValue('OFFSET_LOOKAT_Z_RATIO', CAMERA.OFFSET_LOOKAT_Z_RATIO || 0.2);
  const tiltProgress = state.cameraTiltProgress;
  const offsetDistance = cameraOffsetDistance;

  const startOffsetX = 0;
  const startOffsetY = 0;
  const startOffsetZ = cameraOffsetHeight;

  const endOffsetX = -offsetDistance * lookX * Math.cos(baseAzimuthRadians);
  const endOffsetY = -offsetDistance * lookX * Math.sin(baseAzimuthRadians);
  const endOffsetZ = cameraOffsetHeight * lookZ;

  const offsetX = startOffsetX + (endOffsetX - startOffsetX) * tiltProgress;
  const offsetY = startOffsetY + (endOffsetY - startOffsetY) * tiltProgress;
  const offsetZ = startOffsetZ + (endOffsetZ - startOffsetZ) * tiltProgress;

  const lookAtOffset = new Cesium.Cartesian3(offsetX, offsetY, offsetZ);

  return {
    position: cameraPosition,
    lookAtTarget: cameraLookAtTarget,
    lookAtOffset,
    newState: {
      smoothedHikerPosition: smoothedHikerPos,
      smoothedCameraTarget: smoothedPosition,
      lookAheadTarget: smoothedLookAhead,
      currentRotationAngle: newRotationAngle,
    }
  };
}

/**
 * Apply computed camera state to viewer
 */
export function applyCamera(viewer: Cesium.Viewer, result: CameraUpdateResult): void {
  try {
    viewer.camera.position = result.position;
    viewer.camera.lookAt(result.lookAtTarget, result.lookAtOffset);
  } catch (e) {
    console.warn('Camera update failed:', e);
  }
}

/**
 * Create initial camera state
 */
export function createInitialCameraState(): CameraState {
  return {
    smoothedHikerPosition: null,
    smoothedCameraTarget: null,
    lookAheadTarget: null,
    currentRotationAngle: undefined,
    continuousAzimuth: 0,
    cameraTiltProgress: 0,
  };
}
