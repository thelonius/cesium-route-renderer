import * as Cesium from 'cesium';
import { CameraKeyframe, CameraStrategyContext } from '../types';
import { ICameraStrategy } from './ICameraStrategy';
import { calculateCenter, calculateBounds } from '../utils/cameramath';

/**
 * Bird's Eye Strategy
 * High-altitude overview with camera looking straight down
 */
export class BirdsEyeStrategy implements ICameraStrategy {
  getName(): string {
    return 'birds-eye';
  }

  generateKeyframes(context: CameraStrategyContext): CameraKeyframe[] {
    const { positions, settings } = context;

    // Calculate route center and bounds
    const center = calculateCenter(positions);
    const bounds = calculateBounds(positions);
    const maxDimension = Math.max(bounds.width, bounds.height);

    // Camera height based on route size
    const height = Math.max(
      settings.minHeight,
      Math.min(maxDimension * 0.8, settings.maxHeight)
    );

    // Single keyframe for bird's eye (camera doesn't move)
    const cameraCartographic = Cesium.Cartographic.fromCartesian(center);
    cameraCartographic.height = height;
    const cameraPosition = Cesium.Cartographic.toCartesian(cameraCartographic);

    return [
      {
        timestamp: 0,
        position: cameraPosition,
        orientation: {
          heading: 0,
          pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
          roll: 0
        }
      }
    ];
  }
}
