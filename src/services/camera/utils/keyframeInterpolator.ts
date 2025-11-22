import * as Cesium from 'cesium';
import { CameraKeyframe, CameraSettings } from '../types';
import { lerpAngle, applySmoothingCurve } from './cameramath';

/**
 * Keyframe Generation and Interpolation
 * Handles camera keyframe creation and smooth interpolation
 */

/**
 * Interpolate between two keyframes
 */
export function interpolateKeyframes(
  keyframe1: CameraKeyframe,
  keyframe2: CameraKeyframe,
  t: number,
  settings: CameraSettings
): CameraKeyframe {
  // t is 0-1 between keyframe1 and keyframe2
  const smoothT = applySmoothingCurve(t, settings.smoothingFactor);

  // Interpolate position
  const position = Cesium.Cartesian3.lerp(
    keyframe1.position,
    keyframe2.position,
    smoothT,
    new Cesium.Cartesian3()
  );

  // Interpolate orientation if both have it
  let orientation;
  if (keyframe1.orientation && keyframe2.orientation) {
    orientation = {
      heading: lerpAngle(keyframe1.orientation.heading, keyframe2.orientation.heading, smoothT),
      pitch: Cesium.Math.lerp(keyframe1.orientation.pitch, keyframe2.orientation.pitch, smoothT),
      roll: Cesium.Math.lerp(keyframe1.orientation.roll, keyframe2.orientation.roll, smoothT)
    };
  }

  return {
    timestamp: Cesium.Math.lerp(keyframe1.timestamp, keyframe2.timestamp, t),
    position,
    orientation
  };
}

/**
 * Get keyframe at specific timestamp with interpolation
 */
export function getKeyframeAtTime(
  keyframes: CameraKeyframe[],
  timestamp: number,
  settings: CameraSettings
): CameraKeyframe | null {
  if (keyframes.length === 0) return null;

  // Find surrounding keyframes
  let prevKeyframe = keyframes[0];
  let nextKeyframe = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (keyframes[i].timestamp <= timestamp && keyframes[i + 1].timestamp >= timestamp) {
      prevKeyframe = keyframes[i];
      nextKeyframe = keyframes[i + 1];
      break;
    }
  }

  // If exact match, return it
  if (prevKeyframe.timestamp === timestamp) return prevKeyframe;
  if (nextKeyframe.timestamp === timestamp) return nextKeyframe;

  // Interpolate
  const duration = nextKeyframe.timestamp - prevKeyframe.timestamp;
  if (duration === 0) return prevKeyframe;

  const t = (timestamp - prevKeyframe.timestamp) / duration;
  return interpolateKeyframes(prevKeyframe, nextKeyframe, t, settings);
}
