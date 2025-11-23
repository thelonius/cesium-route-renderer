import * as Cesium from 'cesium';

/**
 * Camera Types and Interfaces
 * Shared type definitions for the camera service
 */

export type CameraStrategy = 'follow' | 'cinematic' | 'birds-eye' | 'static';

export interface CameraSettings {
  strategy: CameraStrategy;
  followDistance: number; // meters
  followHeight: number; // meters
  lookAheadDistance: number; // meters
  smoothingFactor: number; // 0-1, higher = smoother
  enableTilt: boolean;
  enableRotation: boolean;
  minHeight: number; // meters
  maxHeight: number; // meters
}

export interface CameraKeyframe {
  timestamp: number; // seconds from start
  position: Cesium.Cartesian3;
  orientation?: {
    heading: number;
    pitch: number;
    roll: number;
  };
  strategy?: CameraStrategy;
  duration?: number; // seconds to interpolate to this keyframe
}

export interface RouteSegment {
  type: 'climb' | 'descent' | 'turn' | 'straight' | 'peak' | 'valley';
  startIndex: number;
  endIndex: number;
  intensity: number; // 0-1
}

export type RoutePatternType =
  | 'technical_climb'
  | 'scenic_overlook'
  | 'alpine_ridge'
  | 'valley_traverse'
  | 'switchback_section'
  | 'flat_approach'
  | 'loop_around_point'
  | 'unknown';

export interface PatternCameraAdjustment {
  distanceMultiplier: number;
  heightMultiplier: number;
  pitchAdjustment: number;
  smoothingOverride?: number;
  lookAheadMultiplier?: number;
}

export interface CameraStrategyContext {
  positions: Cesium.Cartesian3[];
  times: Cesium.JulianDate[];
  settings: CameraSettings;
  patternAdjustment: PatternCameraAdjustment;
  segments?: RouteSegment[];
}
