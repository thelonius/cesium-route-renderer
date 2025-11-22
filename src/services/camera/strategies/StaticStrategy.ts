import * as Cesium from 'cesium';
import { CameraKeyframe, CameraStrategyContext } from '../types';
import { ICameraStrategy } from './ICameraStrategy';
import { calculateCenter, calculateBounds, calculateCameraPosition, calculateOrientation } from '../utils/cameramath';

/**
 * Static Strategy
 * Fixed camera position viewing the entire route
 */
export class StaticStrategy implements ICameraStrategy {
  getName(): string {
    return 'static';
  }

  generateKeyframes(context: CameraStrategyContext): CameraKeyframe[] {
    const { positions, settings } = context;

    // Calculate route center
    const center = calculateCenter(positions);
    const bounds = calculateBounds(positions);

    // Position camera at optimal viewing angle
    const offset = Math.max(bounds.width, bounds.height) * 0.5;
    const heading = Math.PI / 4; // 45 degrees

    const cameraPosition = calculateCameraPosition(center, heading, offset, settings.followHeight);

    return [
      {
        timestamp: 0,
        position: cameraPosition,
        orientation: calculateOrientation(cameraPosition, center)
      }
    ];
  }
}
