import { RoutePatternType, PatternCameraAdjustment } from './types';

/**
 * Pattern-Based Camera Adjustments
 * Defines how the camera should adjust for different route patterns
 */

export const PATTERN_CAMERA_ADJUSTMENTS: Record<RoutePatternType, PatternCameraAdjustment> = {
  technical_climb: {
    distanceMultiplier: 1.5, // Pull back to show difficulty
    heightMultiplier: 1.3,
    pitchAdjustment: -15, // Tilt up to emphasize climb
    smoothingOverride: 0.75,
    lookAheadMultiplier: 1.2
  },
  scenic_overlook: {
    distanceMultiplier: 2.0, // Wide view for scenery
    heightMultiplier: 1.5,
    pitchAdjustment: -10,
    smoothingOverride: 0.9,
    lookAheadMultiplier: 2.0
  },
  alpine_ridge: {
    distanceMultiplier: 1.8,
    heightMultiplier: 1.4,
    pitchAdjustment: -5,
    smoothingOverride: 0.85,
    lookAheadMultiplier: 1.5
  },
  valley_traverse: {
    distanceMultiplier: 1.2,
    heightMultiplier: 1.1,
    pitchAdjustment: 0,
    smoothingOverride: 0.8,
    lookAheadMultiplier: 1.1
  },
  switchback_section: {
    distanceMultiplier: 1.3,
    heightMultiplier: 1.4, // Higher to see switchback pattern
    pitchAdjustment: -20, // More downward to see turns
    smoothingOverride: 0.7,
    lookAheadMultiplier: 0.8
  },
  flat_approach: {
    distanceMultiplier: 0.9,
    heightMultiplier: 0.9,
    pitchAdjustment: 0,
    smoothingOverride: 0.7,
    lookAheadMultiplier: 1.0
  },
  loop_around_point: {
    distanceMultiplier: 2.5, // Far out to see whole loop + center
    heightMultiplier: 1.8, // Higher to see loop pattern
    pitchAdjustment: -25, // Looking down at loop from outside
    smoothingOverride: 0.92, // Very smooth lazy camera
    lookAheadMultiplier: 0.5 // Less look-ahead, focus on current position
  },
  unknown: {
    distanceMultiplier: 1.0,
    heightMultiplier: 1.0,
    pitchAdjustment: 0,
    smoothingOverride: 0.75,
    lookAheadMultiplier: 1.0
  }
};

export function getPatternAdjustment(pattern: RoutePatternType): PatternCameraAdjustment {
  return PATTERN_CAMERA_ADJUSTMENTS[pattern];
}
