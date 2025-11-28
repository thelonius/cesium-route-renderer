import * as Cesium from 'cesium';

export function getBuildVersion(): string {
  try {
    return (window as any).__BUILD_VERSION || 'dev';
  } catch {
    return 'dev';
  }
}

export function displayStatusBar(info?: any) {
  try {
    if (!info) return;
    console.log(`FPS: ${info.averageFps?.toFixed?.(1)} | Map: ${info.mapProvider} | Terrain: ${info.terrainQuality} | x${info.animationSpeed}`);
  } catch {}
}

export function getTerrainQualityLevel(errorValue: number): string {
  if (!Number.isFinite(errorValue)) return 'unknown';
  if (errorValue <= 2) return 'ultra';
  if (errorValue <= 4) return 'high';
  if (errorValue <= 8) return 'medium';
  return 'low';
}

export function resetClockTime(viewer: Cesium.Viewer, targetTime: Cesium.JulianDate) {
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  viewer.clock.currentTime = Cesium.JulianDate.clone(targetTime);
  viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
}

export enum AnimationPhase {
  NOT_STARTED,
  INTRO,
  PLAYING,
  OUTRO,
  COMPLETE,
}
