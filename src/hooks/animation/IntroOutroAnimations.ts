/**
 * IntroOutroAnimations - Handles intro and outro camera animations
 * Extracted from useCesiumAnimation.ts
 */
import * as Cesium from 'cesium';
import { CameraAnimation } from './CameraAnimation';
import { AnimationPhase, displayStatusBar } from './helpers';

// Import constants
import constants from '../../../config/constants';
const { ANIMATION } = constants;

export interface IntroCallbacks {
  onProgress: (progress: number) => void;
  onComplete: () => void;
}

export interface OutroCallbacks {
  onProgress: (progress: number) => void;
  onComplete: () => void;
}

export interface IntroAnimationOptions {
  viewer: Cesium.Viewer;
  animationSpeed: number;
  setAnimationPhase: (phase: AnimationPhase) => void;
  setCameraAzimuthProgress: (value: number) => void;
  setCameraTiltProgress: (value: number) => void;
  startAzimuthRotation: () => void;
}

export interface OutroAnimationOptions {
  viewer: Cesium.Viewer;
  finalPosition: Cesium.Cartesian3;
  setAnimationPhase: (phase: AnimationPhase) => void;
}

/**
 * Creates and starts the intro animation
 * Gradually tilts camera from overhead view to angled follow view
 */
export function createIntroAnimation(options: IntroAnimationOptions): CameraAnimation {
  const {
    viewer,
    animationSpeed,
    setAnimationPhase,
    setCameraAzimuthProgress,
    setCameraTiltProgress,
    startAzimuthRotation,
  } = options;

  console.log(`🎬 Starting ${ANIMATION.INTRO_DURATION_SECONDS}s intro animation`);

  const introAnimation = new CameraAnimation(
    viewer,
    ANIMATION.INTRO_DURATION_SECONDS,
    (progress) => {
      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      // Update camera progress
      setCameraAzimuthProgress(eased);
      setCameraTiltProgress(eased);
    },
    () => {
      // Intro complete callback
      console.log('✅ Intro complete - starting route animation');

      // Mark ready and intro complete
      try {
        (window as any).CESIUM_INTRO_COMPLETE = true;
        (window as any).CESIUM_ANIMATION_READY = true;
      } catch (e) {}

      // Transition to PLAYING phase
      setAnimationPhase(AnimationPhase.PLAYING);
      setCameraAzimuthProgress(1);
      setCameraTiltProgress(1);

      // Start the clock for route animation
      if (!(window as any).__MANUAL_MULTIPLIER) {
        viewer.clock.multiplier = animationSpeed;
      }
      viewer.clock.shouldAnimate = true;

      // Start azimuth rotation
      startAzimuthRotation();
    }
  );

  return introAnimation;
}

/**
 * Creates and starts the outro animation
 * Tilts camera to face straight down at final position
 */
export function createOutroAnimation(options: OutroAnimationOptions): CameraAnimation {
  const { viewer, finalPosition, setAnimationPhase } = options;

  console.log(`🎬 Starting ${ANIMATION.OUTRO_DURATION_SECONDS}s outro animation - tilting camera to face down`);

  // Capture current camera state
  const startPosition = Cesium.Cartesian3.clone(viewer.camera.position);
  const startDirection = Cesium.Cartesian3.clone(viewer.camera.direction);
  const startUp = Cesium.Cartesian3.clone(viewer.camera.up);

  // Calculate target direction (straight down at hiker)
  const targetDirection = Cesium.Cartesian3.subtract(
    finalPosition,
    startPosition,
    new Cesium.Cartesian3()
  );
  Cesium.Cartesian3.normalize(targetDirection, targetDirection);

  const outroAnimation = new CameraAnimation(
    viewer,
    ANIMATION.OUTRO_DURATION_SECONDS,
    (progress) => {
      // Ease-in cubic for settling motion (starts slow, accelerates)
      const eased = Math.pow(progress, 3);

      try {
        // Keep camera position constant - just rotate
        viewer.camera.position = startPosition;

        // Interpolate direction from current to straight down
        const interpolatedDirection = Cesium.Cartesian3.lerp(
          startDirection,
          targetDirection,
          eased,
          new Cesium.Cartesian3()
        );
        Cesium.Cartesian3.normalize(interpolatedDirection, interpolatedDirection);
        viewer.camera.direction = interpolatedDirection;

        // Interpolate up vector towards north (UNIT_Z)
        const interpolatedUp = Cesium.Cartesian3.lerp(
          startUp,
          Cesium.Cartesian3.UNIT_Z,
          eased,
          new Cesium.Cartesian3()
        );
        Cesium.Cartesian3.normalize(interpolatedUp, interpolatedUp);
        viewer.camera.up = interpolatedUp;
      } catch (e) {
        console.warn('Outro camera update failed:', e);
      }
    },
    () => {
      // Outro complete callback
      console.log('✅ Outro complete - camera facing down');

      // Transition to COMPLETE phase
      setAnimationPhase(AnimationPhase.COMPLETE);

      // Set final camera state
      try {
        viewer.camera.position = startPosition;
        viewer.camera.direction = targetDirection;
        viewer.camera.up = Cesium.Cartesian3.UNIT_Z;
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      } catch (e) {
        console.warn('Failed to set final camera state:', e);
      }

      viewer.clock.shouldAnimate = false;
      (window as any).CESIUM_ANIMATION_COMPLETE = true;
      console.log('✅ CESIUM_ANIMATION_COMPLETE flag set');
      displayStatusBar();
    }
  );

  return outroAnimation;
}

/**
 * Handles the skip-outro path when outro is disabled
 */
export function handleSkipOutro(
  viewer: Cesium.Viewer,
  setAnimationPhase: (phase: AnimationPhase) => void
): void {
  setAnimationPhase(AnimationPhase.COMPLETE);
  viewer.clock.shouldAnimate = false;
  (window as any).CESIUM_ANIMATION_COMPLETE = true;
  console.log('✅ Route ended - CESIUM_ANIMATION_COMPLETE flag set (outro skipped)');
  displayStatusBar();
}
