import * as Cesium from 'cesium';
import { CameraKeyframe, CameraStrategyContext } from '../types';
import { ICameraStrategy } from './ICameraStrategy';
import {
  calculateHeading,
  calculateCameraPosition,
  calculateLookAtPosition,
  calculateOrientation
} from '../utils/cameramath';

/**
 * Follow Strategy
 * Camera follows behind the moving entity
 */
export class FollowStrategy implements ICameraStrategy {
  getName(): string {
    return 'follow';
  }

  generateKeyframes(context: CameraStrategyContext): CameraKeyframe[] {
    const { positions, times, settings, patternAdjustment } = context;
    const keyframes: CameraKeyframe[] = [];

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const nextPosition = positions[Math.min(i + 1, positions.length - 1)];

      // Calculate heading (direction of travel)
      const heading = calculateHeading(position, nextPosition);

      // Apply pattern adjustments
      const adjustedDistance = settings.followDistance * patternAdjustment.distanceMultiplier;
      const adjustedHeight = settings.followHeight * patternAdjustment.heightMultiplier;
      const adjustedLookAhead =
        settings.lookAheadDistance * (patternAdjustment.lookAheadMultiplier || 1.0);

      // Camera position: behind and above
      const cameraPosition = calculateCameraPosition(
        position,
        heading,
        adjustedDistance,
        adjustedHeight
      );

      // Look at point: ahead of entity
      const lookAtPosition = calculateLookAtPosition(position, heading, adjustedLookAhead);

      const orientation = calculateOrientation(cameraPosition, lookAtPosition);

      // Apply pitch adjustment from pattern
      orientation.pitch += patternAdjustment.pitchAdjustment * (Math.PI / 180);

      keyframes.push({
        timestamp: Cesium.JulianDate.secondsDifference(times[i], times[0]),
        position: cameraPosition,
        orientation
      });
    }

    return keyframes;
  }
}
