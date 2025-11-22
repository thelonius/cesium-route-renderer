import * as Cesium from 'cesium';
import { CameraKeyframe, CameraStrategyContext } from '../types';

/**
 * Base Strategy Interface
 * All camera strategies must implement this interface
 */
export interface ICameraStrategy {
  generateKeyframes(context: CameraStrategyContext): CameraKeyframe[];
  getName(): string;
}
