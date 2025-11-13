// Adaptive Animation Speed System
// Add this to useCesiumAnimation.ts to dynamically adjust speed based on frame performance

import * as Cesium from 'cesium';

interface PerformanceMonitor {
  frameTimeHistory: number[];
  lastFrameTime: number;
  targetFPS: number;
  targetFrameTime: number;
  baseSpeed: number;
  currentSpeed: number;
  minSpeed: number;
  maxSpeed: number;
}

export function createAdaptiveSpeedController(
  viewer: Cesium.Viewer,
  baseAnimationSpeed: number,
  targetFPS: number = 90
): PerformanceMonitor {

  const monitor: PerformanceMonitor = {
    frameTimeHistory: [],
    lastFrameTime: performance.now(),
    targetFPS,
    targetFrameTime: 1000 / targetFPS, // ms per frame
    baseSpeed: baseAnimationSpeed,
    currentSpeed: baseAnimationSpeed,
    minSpeed: baseAnimationSpeed * 0.5, // Don't go below 50% of base
    maxSpeed: baseAnimationSpeed,
  };

  let frameCount = 0;
  let adjustmentCooldown = 0;

  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    const frameTime = now - monitor.lastFrameTime;
    monitor.lastFrameTime = now;

    // Track frame times
    monitor.frameTimeHistory.push(frameTime);
    if (monitor.frameTimeHistory.length > 30) {
      monitor.frameTimeHistory.shift(); // Keep last 30 frames (0.33s at 90fps)
    }

    frameCount++;
    if (adjustmentCooldown > 0) {
      adjustmentCooldown--;
      return;
    }

    // Only adjust every 30 frames (avoid thrashing)
    if (frameCount % 30 !== 0) return;

    const avgFrameTime =
      monitor.frameTimeHistory.reduce((a, b) => a + b, 0) /
      monitor.frameTimeHistory.length;

    const performanceRatio = avgFrameTime / monitor.targetFrameTime;

    // Performance thresholds
    const POOR_PERFORMANCE = 1.3;  // 30% over target
    const GOOD_PERFORMANCE = 0.8;  // 20% under target
    const ADJUSTMENT_RATE = 0.1;   // Adjust by 10% each time

    if (performanceRatio > POOR_PERFORMANCE) {
      // Performance is poor - reduce speed
      const newSpeed = monitor.currentSpeed * (1 - ADJUSTMENT_RATE);
      monitor.currentSpeed = Math.max(monitor.minSpeed, newSpeed);

      if (viewer.clock.multiplier > 0) {
        viewer.clock.multiplier = monitor.currentSpeed;
      }

      console.log(
        `⚠️ Frame drop detected (${avgFrameTime.toFixed(1)}ms avg). ` +
        `Reducing speed to ${monitor.currentSpeed.toFixed(1)}x`
      );

      adjustmentCooldown = 60; // Wait 60 frames before next adjustment

    } else if (
      performanceRatio < GOOD_PERFORMANCE &&
      monitor.currentSpeed < monitor.maxSpeed
    ) {
      // Performance is good - try increasing speed back to base
      const newSpeed = monitor.currentSpeed * (1 + ADJUSTMENT_RATE);
      monitor.currentSpeed = Math.min(monitor.maxSpeed, newSpeed);

      if (viewer.clock.multiplier > 0) {
        viewer.clock.multiplier = monitor.currentSpeed;
      }

      console.log(
        `✅ Good performance (${avgFrameTime.toFixed(1)}ms avg). ` +
        `Increasing speed to ${monitor.currentSpeed.toFixed(1)}x`
      );

      adjustmentCooldown = 60;
    }

    // Log current performance every 300 frames (~3.3s at 90fps)
    if (frameCount % 300 === 0) {
      const currentFPS = 1000 / avgFrameTime;
      console.log(
        `📊 Performance: ${currentFPS.toFixed(1)} FPS ` +
        `(${avgFrameTime.toFixed(1)}ms), Speed: ${monitor.currentSpeed.toFixed(1)}x`
      );
    }
  });

  return monitor;
}

// Usage example in useCesiumAnimation.ts:
/*
  // After viewer is ready and initial animation complete
  const performanceMonitor = createAdaptiveSpeedController(
    viewer,
    animationSpeed,
    90  // Target 90 FPS
  );

  // The system will automatically adjust viewer.clock.multiplier
  // based on actual rendering performance
*/

// Quality profile presets
export const QualityPresets = {
  ULTRA: {
    speed: 30,
    fps: 90,
    screenSpaceError: 1.5,
    shadows: true,
    lighting: true,
    hdr: true,
    fxaa: true,
    description: 'Maximum quality, slowest recording'
  },
  HIGH: {
    speed: 50,
    fps: 90,
    screenSpaceError: 2.0,
    shadows: true,
    lighting: true,
    hdr: true,
    fxaa: true,
    description: 'High quality, balanced speed (default)'
  },
  BALANCED: {
    speed: 75,
    fps: 60,
    screenSpaceError: 2.5,
    shadows: false,
    lighting: true,
    hdr: false,
    fxaa: true,
    description: 'Good quality, faster recording'
  },
  FAST: {
    speed: 100,
    fps: 30,
    screenSpaceError: 4.0,
    shadows: false,
    lighting: false,
    hdr: false,
    fxaa: false,
    description: 'Quick preview, fastest recording'
  }
} as const;

export type QualityPreset = keyof typeof QualityPresets;

export function applyQualityPreset(
  viewer: Cesium.Viewer,
  preset: QualityPreset
): number {
  const settings = QualityPresets[preset];

  // Apply graphics settings
  viewer.scene.globe.maximumScreenSpaceError = settings.screenSpaceError;
  viewer.scene.globe.enableLighting = settings.lighting;
  viewer.shadows = settings.shadows;
  viewer.scene.highDynamicRange = settings.hdr;

  if (viewer.scene.postProcessStages.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = settings.fxaa;
  }

  console.log(`🎨 Quality preset: ${preset} - ${settings.description}`);
  console.log(`Speed: ${settings.speed}x, FPS: ${settings.fps}, SSE: ${settings.screenSpaceError}`);

  return settings.speed;
}
