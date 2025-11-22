import * as Cesium from 'cesium';
import { CameraKeyframe, CameraStrategyContext, RouteSegment } from '../types';
import { ICameraStrategy } from './ICameraStrategy';
import {
  calculateHeading,
  calculateCameraPosition,
  calculateLookAtPosition,
  calculateOrientation
} from '../utils/cameramath';

/**
 * Cinematic Strategy
 * Dynamic camera angles based on route characteristics
 */
export class CinematicStrategy implements ICameraStrategy {
  getName(): string {
    return 'cinematic';
  }

  generateKeyframes(context: CameraStrategyContext): CameraKeyframe[] {
    const { positions, times, settings, patternAdjustment, segments = [] } = context;
    const keyframes: CameraKeyframe[] = [];

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const nextPosition = positions[Math.min(i + 1, positions.length - 1)];

      // Find active segment
      const activeSegment = segments.find(
        (seg) => i >= seg.startIndex && i <= seg.endIndex
      );

      // Adjust camera based on segment type
      const adjustments = this.getSegmentAdjustments(activeSegment, patternAdjustment);

      const heading = calculateHeading(position, nextPosition);
      const distance = settings.followDistance * adjustments.distanceMultiplier;
      const height = settings.followHeight * adjustments.heightMultiplier;
      const lookAhead = settings.lookAheadDistance * adjustments.lookAheadMultiplier;

      const cameraPosition = calculateCameraPosition(position, heading, distance, height);
      const lookAtPosition = calculateLookAtPosition(position, heading, lookAhead);

      const orientation = calculateOrientation(cameraPosition, lookAtPosition);
      orientation.pitch += adjustments.pitchAdjustment * (Math.PI / 180);

      keyframes.push({
        timestamp: Cesium.JulianDate.secondsDifference(times[i], times[0]),
        position: cameraPosition,
        orientation
      });
    }

    return keyframes;
  }

  private getSegmentAdjustments(
    segment: RouteSegment | undefined,
    baseAdjustment: any
  ): {
    distanceMultiplier: number;
    heightMultiplier: number;
    pitchAdjustment: number;
    lookAheadMultiplier: number;
  } {
    let distanceMultiplier = baseAdjustment.distanceMultiplier;
    let heightMultiplier = baseAdjustment.heightMultiplier;
    let pitchAdjustment = baseAdjustment.pitchAdjustment;
    const lookAheadMultiplier = baseAdjustment.lookAheadMultiplier || 1.0;

    if (segment) {
      switch (segment.type) {
        case 'climb':
          // Pull back and tilt up during climbs
          distanceMultiplier *= 1.3;
          heightMultiplier *= 1.2;
          pitchAdjustment -= 10 * segment.intensity;
          break;

        case 'descent':
          // Get closer and tilt down during descents
          distanceMultiplier *= 0.8;
          heightMultiplier *= 0.9;
          pitchAdjustment += 10 * segment.intensity;
          break;

        case 'turn':
          // Swing wide on turns
          distanceMultiplier *= 1.2;
          heightMultiplier *= 1.1;
          break;
      }
    }

    return {
      distanceMultiplier,
      heightMultiplier,
      pitchAdjustment,
      lookAheadMultiplier
    };
  }
}
