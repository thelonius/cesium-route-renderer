import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { TrackPoint } from '../types';
import { detectLoop, getLazyCameraTarget } from '../services/camera/utils/loopDetector';
import { CameraAnimation } from './animation/CameraAnimation';
import { getBuildVersion, displayStatusBar, getTerrainQualityLevel, resetClockTime, AnimationPhase } from './animation/helpers';
import { computeCameraUpdate, applyCamera, CameraState, LoopInfo } from './animation/TrackCameraController';
import { createIntroAnimation, createOutroAnimation, handleSkipOutro } from './animation/IntroOutroAnimations';
import { updateTrail, detectTrailGap, findNearestSample, logNearestSampleDiagnostic, isDockerEnvironment, isTrailResetEnabled } from './animation/TrailManager';
import { createHikerEntity, createTrailEntity, createFullRouteEntity, removeEntities, setInitialCameraPosition, getHikerDisplayName } from './animation/EntityFactory';

// Import constants from central config
import constants from '../../config/constants';
import { getCameraValue } from '../services/camera/runtimeConstants';
const { CAMERA, ANIMATION } = constants;

// AnimationPhase imported from helpers

// CameraAnimation imported from animation/CameraAnimation

// Status tracking for local development
let statusInfo = {
  buildVersion: 'dev',
  averageFps: 0,
  mapProvider: 'unknown',
  terrainQuality: 'unknown',
  animationSpeed: 0,
  frameCount: 0,
  startTime: null as number | null,
  lastFrameTime: 0,
  frameTimes: [] as number[]
};

// getBuildVersion imported from helpers

// displayStatusBar imported from helpers

// getTerrainQualityLevel imported from helpers

interface UseCesiumAnimationProps {
  viewer: Cesium.Viewer | null;
  trackPoints: TrackPoint[];
  startTime: Cesium.JulianDate | undefined;
  stopTime: Cesium.JulianDate | undefined;
  animationSpeed?: number; // Optional animation speed multiplier (default 2x)
}

export default function useCesiumAnimation({
  viewer,
  trackPoints,
  startTime,
  stopTime,
  animationSpeed = ANIMATION.DEFAULT_SPEED // High speed for fast playback
}: UseCesiumAnimationProps) {

  const trailPositionsRef = useRef<Cesium.Cartesian3[]>([]);
  const lastAddedTimeRef = useRef<Cesium.JulianDate | null>(null);
  const smoothedBackRef = useRef(CAMERA.BASE_BACK);
  const smoothedHeightRef = useRef(CAMERA.BASE_HEIGHT);
  const cameraAzimuthProgressRef = useRef(0); // 0 = no rotation, 1 = full azimuth (for opening)
  const cameraTiltProgressRef = useRef(0); // 0 = looking down, 1 = fully tilted

  // Animation phase state machine
  const animationPhaseRef = useRef<AnimationPhase>(AnimationPhase.NOT_STARTED);

  const continuousAzimuthRef = useRef(0); // Continuous slow rotation during main route
  const cameraPanOffsetRef = useRef(0); // Side-to-side panning offset
  const azimuthRotationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkCompletionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationStartedRef = useRef(false);
  const [entity, setEntity] = useState<Cesium.Entity | null>(null);
  const listenersRef = useRef<{ pre: any; post: any } | null>(null);
  const entitiesRef = useRef<{ hiker: Cesium.Entity | null; trail: Cesium.Entity | null }>({ hiker: null, trail: null });
  const preRenderFrameCounter = useRef(0);
  const runtimeLogLastRef = useRef<number>(0);

  // Loop detection and lazy camera refs
  const loopCentroidRef = useRef<Cesium.Cartesian3 | null>(null);
  const loopRadiusRef = useRef<number>(0);
  const isLoopRouteRef = useRef(false);
  const smoothedCameraTargetRef = useRef<Cesium.Cartesian3 | null>(null);
  const smoothedHikerPositionRef = useRef<Cesium.Cartesian3 | null>(null);
  const lookAheadTargetRef = useRef<Cesium.Cartesian3 | null>(null);
  const initialCameraSetRef = useRef(false);
  const initialAzimuthRef = useRef<number>(0); // Starting azimuth from hiker's initial position
  const currentRotationAngleRef = useRef<number>(0); // Current rotation around centroid

  useEffect(() => {
    if (!viewer || !trackPoints.length || !startTime || !stopTime) return;

    // Runtime toggles: diagnostics and manual stepping (opt-in)
    const enableDiagnostics = !!(window as any).__ENABLE_DIAGNOSTICS;
    const forceManualStepping = !!(window as any).__FORCE_MANUAL_STEPPING || !!(window as any).__MANUAL_STEPPING;
    const isHeadless = (() => {
      try {
        const ua = (navigator && navigator.userAgent) || '';
        return /HeadlessChrome|PhantomJS/.test(ua) || new URLSearchParams(window.location.search).get('docker') === 'true';
      } catch (e) {
        return false;
      }
    })();
    const dlog = (...args: any[]) => { if (enableDiagnostics) console.log(...args); };

    // Helper to centrally set currentTime with debug logging
    const safeSetCurrentTime = (jd: Cesium.JulianDate | undefined | null, reason?: string) => {
      try {
        if (!jd) return;
        const iso = Cesium.JulianDate.toIso8601(jd);
        dlog('safeSetCurrentTime:', reason || 'unknown', iso);
        viewer.clock.currentTime = Cesium.JulianDate.clone(jd);
      } catch (e) {
        console.warn('safeSetCurrentTime failed:', e);
      }
    };

    // Reset animation state for new route
    cameraAzimuthProgressRef.current = 0;
    cameraTiltProgressRef.current = 0;
    animationPhaseRef.current = AnimationPhase.INTRO;
    continuousAzimuthRef.current = 0;
    cameraPanOffsetRef.current = 0;
    trailPositionsRef.current = [];
    dlog('Animation state reset for new route');

    // Helper to start azimuth rotation interval
    const startAzimuthRotation = () => {
      if (azimuthRotationIntervalRef.current) {
        clearInterval(azimuthRotationIntervalRef.current);
      }
      azimuthRotationIntervalRef.current = setInterval(() => {
        const phase = animationPhaseRef.current;
        if (!viewer || viewer.isDestroyed() || phase === AnimationPhase.OUTRO || phase === AnimationPhase.COMPLETE || !viewer.clock || !viewer.clock.shouldAnimate) {
          if (azimuthRotationIntervalRef.current) {
            clearInterval(azimuthRotationIntervalRef.current);
            azimuthRotationIntervalRef.current = null;
          }
          return;
        }
        continuousAzimuthRef.current += 0.05;
        if (continuousAzimuthRef.current >= 360) continuousAzimuthRef.current = 0;
      }, 100);

      // Monitor for route completion
      if (checkCompletionIntervalRef.current) {
        clearInterval(checkCompletionIntervalRef.current);
      }
      checkCompletionIntervalRef.current = setInterval(() => {
        if (!viewer || viewer.isDestroyed() || !viewer.clock) {
          if (checkCompletionIntervalRef.current) {
            clearInterval(checkCompletionIntervalRef.current);
            checkCompletionIntervalRef.current = null;
          }
          return;
        }
      }, 100);
    };

    // Intro animation function using extracted module
    const startIntroAnimation = () => {
      const introAnimation = createIntroAnimation({
        viewer,
        animationSpeed,
        setAnimationPhase: (phase) => { animationPhaseRef.current = phase; },
        setCameraAzimuthProgress: (value) => { cameraAzimuthProgressRef.current = value; },
        setCameraTiltProgress: (value) => { cameraTiltProgressRef.current = value; },
        startAzimuthRotation,
      });
      introAnimation.start();
    };

    // ===== HELPER FUNCTIONS =====

    /**
     * Reset clock time - requires temporary UNBOUNDED mode
     *
     * Why? Cesium's CLAMPED mode prevents the clock from going backwards
     * (it clamps between startTime and stopTime). When restarting, we need
     * to jump from stopTime back to startTime, which requires temporarily
     * switching to UNBOUNDED mode, making the change, then switching back
     * to CLAMPED to prevent automatic looping.
     */
    const resetClockTime = (targetTime: Cesium.JulianDate) => {
      viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
      viewer.clock.currentTime = Cesium.JulianDate.clone(targetTime);
      viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    };

    /** Check if animation should auto-stop at end (only during PLAYING phase) */
    const shouldStopAtEnd = (currentPhase: AnimationPhase): boolean => {
      return currentPhase === AnimationPhase.PLAYING;
    };

    /** Check if early reset is allowed (prevents reset during INTRO/OUTRO) */
    const canResetEarly = (currentPhase: AnimationPhase): boolean => {
      return currentPhase === AnimationPhase.NOT_STARTED;
    };    // Global restart function - resets animation to beginning
    (window as any).__restartRoute = () => {
      try {
        console.log('🔄 Restarting route animation');

        // 1. Reset all camera state
        cameraAzimuthProgressRef.current = 0;
        cameraTiltProgressRef.current = 0;
        continuousAzimuthRef.current = 0;
        cameraPanOffsetRef.current = 0;
        smoothedCameraTargetRef.current = null;
        smoothedHikerPositionRef.current = null;
        lookAheadTargetRef.current = null;
        smoothedBackRef.current = CAMERA.BASE_BACK;
        smoothedHeightRef.current = CAMERA.BASE_HEIGHT;
        initialCameraSetRef.current = false;
        currentRotationAngleRef.current = undefined as any;

        // 2. Reset animation state
        animationPhaseRef.current = AnimationPhase.INTRO;
        animationStartedRef.current = false;
        preRenderFrameCounter.current = 0;
        trailPositionsRef.current = [];
        lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);


        // 3. Reset Cesium clock
        resetClockTime(startTime);
        viewer.clock.shouldAnimate = false; // Intro will start it        // 4. Reset multiplier
        if (!(window as any).__MANUAL_MULTIPLIER) {
          viewer.clock.multiplier = animationSpeed;
        }

        // 5. Clear global completion flags
        (window as any).CESIUM_ANIMATION_COMPLETE = false;
        (window as any).CESIUM_INTRO_COMPLETE = false;
        (window as any).CESIUM_ANIMATION_READY = false;

        // 6. Start intro animation
        startIntroAnimation();

        console.log('✅ Route restarted');
      } catch (e) {
        console.error('Error restarting route:', e);
      }
    };

    const initializeAnimation = () => {
      // Initialize FPS tracking
      statusInfo.buildVersion = getBuildVersion();
      statusInfo.animationSpeed = animationSpeed;
      statusInfo.startTime = Date.now();
      statusInfo.frameCount = 0;
      statusInfo.lastFrameTime = performance.now();
      statusInfo.frameTimes = [];
      lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);

      // Configure Cesium clock
      viewer.clock.startTime = Cesium.JulianDate.clone(startTime);
      viewer.clock.stopTime = Cesium.JulianDate.clone(stopTime);
      viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
      viewer.clock.clockRange = Cesium.ClockRange.CLAMPED; // Stop at end, don't loop
      viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT; // Advance by multiplier per frame

      // Set animation speed (unless manually overridden)
      if (!(window as any).__MANUAL_MULTIPLIER) {
        viewer.clock.multiplier = animationSpeed;
      }

      // Ensure valid duration (handle edge case where start == stop)
      try {
        const initialDuration = Cesium.JulianDate.secondsDifference(viewer.clock.stopTime, viewer.clock.startTime);
        if (!Number.isFinite(initialDuration) || initialDuration <= 0) {
          const syntheticSeconds = Math.max(60, Math.ceil(trackPoints.length / 10));
          const newStop = Cesium.JulianDate.addSeconds(viewer.clock.startTime, syntheticSeconds, new Cesium.JulianDate());
          viewer.clock.stopTime = Cesium.JulianDate.clone(newStop);
          console.warn('Adjusted stopTime due to non-positive duration; using', syntheticSeconds, 'seconds');
        }
      } catch (e) {
        console.warn('Could not validate/adjust stopTime:', e);
      }

      console.log(`Animation configured: ${Cesium.JulianDate.toIso8601(startTime)} to ${Cesium.JulianDate.toIso8601(stopTime)}`);

      // Use original track points without filtering
      const filteredPoints = trackPoints;

      // Track point diagnostics (only log first 10 samples in dev mode)
      if (enableDiagnostics) {
        try {
          console.log(`Track points: ${filteredPoints.length}`);
        if (filteredPoints.length > 0) {
          console.log('First point time:', filteredPoints[0].time, 'Last point time:', filteredPoints[filteredPoints.length - 1].time);
        }
      } catch (e) {
        // ignore diagnostics failures
      }
    }

    // If all timestamps are identical or missing, synthesize a monotonic timeline
    try {
      const times = filteredPoints.map(p => (p.time || '').trim());
      const uniqueTimes = Array.from(new Set(times.filter(t => t !== '')));
      if (uniqueTimes.length <= 1) {
        console.warn('Detected identical or missing timestamps for all points — synthesizing timeline to enable animation');
        const syntheticDuration = Math.max(60, Math.ceil(filteredPoints.length / 10)); // seconds
        const base = Cesium.JulianDate.now();
        for (let i = 0; i < filteredPoints.length; i++) {
          const t = Cesium.JulianDate.addSeconds(base, Math.round((i / Math.max(1, filteredPoints.length - 1)) * syntheticDuration), new Cesium.JulianDate());
          filteredPoints[i].time = Cesium.JulianDate.toIso8601(t);
        }
        // Update clock range accordingly
        try {
          const newStart = Cesium.JulianDate.fromIso8601(filteredPoints[0].time);
          const newStop = Cesium.JulianDate.fromIso8601(filteredPoints[filteredPoints.length - 1].time);
          viewer.clock.startTime = Cesium.JulianDate.clone(newStart);
          viewer.clock.stopTime = Cesium.JulianDate.clone(newStop);
          viewer.clock.currentTime = Cesium.JulianDate.clone(newStart);
          console.log('Synthesized timeline:', Cesium.JulianDate.toIso8601(newStart), '->', Cesium.JulianDate.toIso8601(newStop));
        } catch (err) {
          console.warn('Failed to apply synthesized timeline to viewer clock:', err);
        }
      }
    } catch (err) {
      // non-fatal
    }

    // Create position property with linear interpolation
    const hikerPositions = new Cesium.SampledPositionProperty();

    // Use linear interpolation for straight-line movement between track points
    // Note: Hermite caused crashes when enabled with all track points (Nov 7, 2025)
    hikerPositions.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation
    });

    filteredPoints.forEach(point => {
      const time = Cesium.JulianDate.fromIso8601(point.time);
      const position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.ele);
      hikerPositions.addSample(time, position);
    });

    // Sample point diagnostics - check for malformed or non-monotonic data
    if (enableDiagnostics) {
      try {
        const sampleCount = filteredPoints.length;
        console.log(`Hiker samples added: ${sampleCount}`);
        const samplesToLog = Math.min(10, sampleCount);
        for (let i = 0; i < samplesToLog; i++) {
          const p = filteredPoints[i];
          console.log(`sample[${i}] lat=${p.lat} lon=${p.lon} ele=${p.ele} time=${p.time}`);
        }
        if (sampleCount > samplesToLog) {
          for (let i = sampleCount - samplesToLog; i < sampleCount; i++) {
            const p = filteredPoints[i];
            console.log(`sample[${i}] lat=${p.lat} lon=${p.lon} ele=${p.ele} time=${p.time}`);
          }
        }

        // Check monotonicity
        let prevTime: Cesium.JulianDate | null = null;
        for (let i = 0; i < filteredPoints.length; i++) {
          try {
            const t = Cesium.JulianDate.fromIso8601(filteredPoints[i].time);
            if (prevTime && Cesium.JulianDate.compare(t, prevTime) <= 0) {
              console.warn(`Non-monotonic timestamp at index ${i}: ${filteredPoints[i].time}`);
              break;
            }
            prevTime = t;
          } catch (e) {
            console.warn('Failed to parse timestamp for index', i, filteredPoints[i] && filteredPoints[i].time);
            break;
          }
        }
      } catch (e) {
        console.warn('Track point diagnostics failed:', e);
      }
    }

    // Get userName from URL params
    const userName = new URLSearchParams(window.location.search).get('userName') || 'Hiker';

    // Create entity for the hiker using EntityFactory
    const hikerEntity = createHikerEntity(viewer, {
      positionProperty: hikerPositions,
      startTime,
      stopTime,
      userName,
    });

    setEntity(hikerEntity);
    entitiesRef.current.hiker = hikerEntity;

    // Create full route polyline using filtered points for smoother line
    const fullRoutePositions = filteredPoints
      .map(point => {
        const lon = Number(point.lon);
        const lat = Number(point.lat);
        const ele = Number(point.ele) || 0;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        return Cesium.Cartesian3.fromDegrees(lon, lat, ele);
      })
      .filter(Boolean) as Cesium.Cartesian3[];

    // Create full route entity using EntityFactory
    createFullRouteEntity(viewer, { positions: fullRoutePositions });

    // Create dynamic trail using EntityFactory
    const trailEntity = createTrailEntity(viewer, {
      getPositions: () => trailPositionsRef.current,
    });
    entitiesRef.current.trail = trailEntity;

    // Detect if route forms a loop around a focal point
    try {
      const loopAnalysis = detectLoop(fullRoutePositions);
      if (loopAnalysis.isLoop) {
        isLoopRouteRef.current = true;
        loopCentroidRef.current = loopAnalysis.centroid;
        loopRadiusRef.current = loopAnalysis.averageRadius;
        console.log(`🔄 Loop route detected! Loopness: ${loopAnalysis.loopness.toFixed(2)}, ` +
          `Radius: ${(loopAnalysis.averageRadius / 1000).toFixed(1)}km`);
        console.log(`   Camera will use centroid-focused "outside looking in" mode`);
        try { (window as any).__ROUTE_TYPE = 'loop'; } catch (e) {}
      }
    } catch (e) {
      console.warn('Loop detection failed:', e);
      try { (window as any).__ROUTE_TYPE = 'linear'; } catch (err) {}
    }
    // Default to linear if not explicitly set
    try { (window as any).__ROUTE_TYPE = (window as any).__ROUTE_TYPE || 'linear'; } catch (e) {}

    // Expose helper to check loop state
    (window as any).__checkLoopState = () => {
      console.log('Loop State:', {
        isLoop: isLoopRouteRef.current,
        hasCentroid: !!loopCentroidRef.current,
        radius: loopRadiusRef.current,
        currentRotation: currentRotationAngleRef.current,
        isInitialAnimation: animationPhaseRef.current === AnimationPhase.INTRO
      });
    };

    // Setup camera tracking
    const preRenderListener = () => {
      try {
        // Diagnostic: log first few frames to ensure clock is advancing
        if (preRenderFrameCounter.current < 5) {
          try {
            console.log('preRender frame', preRenderFrameCounter.current, 'clock.shouldAnimate=', !!viewer.clock.shouldAnimate, 'currentTime=', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
          } catch (e) {}
          preRenderFrameCounter.current += 1;
        }
        // Keep trail visible during ending animation (removed early return)

        if (!hikerEntity || !hikerEntity.position || !lastAddedTimeRef.current) return;
        const currentTime = viewer.clock.currentTime;

        // Defensive: if on the first few frames the clock is already at stopTime
        // (which causes the hiker to teleport immediately), rewind it to startTime
        // so playback can proceed normally. This guards against race conditions
        // where the clock was advanced externally before the render loop stabilized.
        // ONLY reset if animation hasn't started yet AND we're not in INTRO/OUTRO phase.
        try {
          const currentPhase = animationPhaseRef.current;
          const canonicalStopEarly = viewer.clock.stopTime || stopTime;
          if (!animationStartedRef.current &&
              preRenderFrameCounter.current < 10 &&
              canResetEarly(currentPhase) &&
              Cesium.JulianDate.compare(currentTime, canonicalStopEarly) >= 0) {
            console.warn('Early clock at/after stopTime detected in preRender; resetting to startTime to allow playback');
            safeSetCurrentTime(viewer.clock.startTime || startTime, 'preRender early-reset');
          }
        } catch (e) {
          // ignore
        }

        // Reset trail when animation loops
        if (Cesium.JulianDate.compare(currentTime, lastAddedTimeRef.current) < 0) {
          // This behavior can be toggled at runtime. By default the reset is disabled
          // to keep the entire trail visible. To re-enable, set `window.__ENABLE_TRAIL_RESET = true` in the console.
          if (isTrailResetEnabled()) {
            trailPositionsRef.current = [];
            lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);
            return;
          } else {
            // Don't clear trail; just reset the lastAddedTime pointer and continue
            lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);
          }
        }

        const currentPosition = hikerEntity.position.getValue(currentTime);
        if (!currentPosition) return;

        const dt = Cesium.JulianDate.secondsDifference(currentTime, lastAddedTimeRef.current);
        if (dt < CAMERA.TRAIL_ADD_INTERVAL_SECONDS && trailPositionsRef.current.length > 0) return;

        // Check for large gaps or time jumps using TrailManager
        if (trailPositionsRef.current.length > 0) {
          const lastPosition = trailPositionsRef.current[trailPositionsRef.current.length - 1];
          const gapResult = detectTrailGap(currentPosition, lastPosition, dt, animationSpeed);

          if (gapResult.hasGap && gapResult.gapType) {
            const isDocker = isDockerEnvironment();
            if (!isDocker) {
              if (gapResult.gapType === 'distance') {
                try { console.log(`Large gap detected (${(gapResult.value/1000).toFixed(1)}km) at time ${Cesium.JulianDate.toIso8601(currentTime)}, resetting trail`); } catch (e) { console.log(`Large gap detected (${(gapResult.value/1000).toFixed(1)}km), resetting trail`); }
              } else {
                console.log(`Time jump detected (${gapResult.value.toFixed(1)}s), resetting trail`);
              }
            }

            // Log nearest sample for debugging
            const nearestSample = findNearestSample(filteredPoints, currentTime);
            if (nearestSample.index >= 0) {
              logNearestSampleDiagnostic(nearestSample, currentPosition);
            }

            // Respect runtime flag before clearing the trail
            if (isTrailResetEnabled()) {
              trailPositionsRef.current = [];
            } else {
              console.log('Trail reset suppressed (window.__ENABLE_TRAIL_RESET is false)');
            }
          }
        }

        try {
          trailPositionsRef.current.push(currentPosition.clone());
        } catch (e) {
          console.warn('Failed to clone currentPosition for trail, skipping point:', e);
        }

        // Keep full trail visible - don't remove old points

        lastAddedTimeRef.current = Cesium.JulianDate.clone(currentTime);
      } catch (err) {
        console.error('Error in preRender handler:', err);
      }
    };

    const postRenderListener = () => {
      try {
      dlog('postRender called, clock shouldAnimate=', viewer.clock.shouldAnimate, 'multiplier=', viewer.clock.multiplier, 'currentTime=', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));

      // Check if animation has reached the end - only when PLAYING
      const animationStopTime = viewer.clock.stopTime || stopTime;
      const currentPhase = animationPhaseRef.current;
      if (shouldStopAtEnd(currentPhase) &&
          Cesium.JulianDate.compare(viewer.clock.currentTime, animationStopTime) >= 0 &&
          viewer.clock.shouldAnimate) {
        console.log('🎯 Animation reached end - stopping clock until manual restart');
        viewer.clock.shouldAnimate = false;
        (window as any).CESIUM_ANIMATION_COMPLETE = true;
      }

        // Track frame count and timing for FPS calculation
        const frameTimeStamp = performance.now();
        const frameTime = frameTimeStamp - statusInfo.lastFrameTime;
        statusInfo.lastFrameTime = frameTimeStamp;
        statusInfo.frameCount++;

        // Track frame times for average calculation (keep last 60 frames)
        statusInfo.frameTimes.push(frameTime);
        if (statusInfo.frameTimes.length > 60) {
          statusInfo.frameTimes.shift();
        }

        // Calculate average FPS from frame times
        if (statusInfo.frameTimes.length > 0) {
          const averageFrameTime = statusInfo.frameTimes.reduce((a, b) => a + b, 0) / statusInfo.frameTimes.length;
          statusInfo.averageFps = 1000 / averageFrameTime;
        }

        // Stop controlling camera during outro/complete phases
        const phase = animationPhaseRef.current;
        if (phase === AnimationPhase.OUTRO || phase === AnimationPhase.COMPLETE) return;

        if (!hikerEntity || !hikerEntity.position) return;
        const currentTime = viewer.clock.currentTime;

        // Use canonical stopTime from the viewer.clock in case it was adjusted above
        const canonicalStop = viewer.clock.stopTime || stopTime;

        // Validate current time is within route bounds (but not during ending sequence)
        if (Cesium.JulianDate.compare(currentTime, startTime) < 0 ||
          Cesium.JulianDate.compare(currentTime, canonicalStop) >= 0) {
          // Time is out of bounds - clamp to valid range and STOP
          if (Cesium.JulianDate.compare(currentTime, startTime) < 0) {
            viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
          } else {
            // Route has ended naturally
            console.log('Route end detected. currentTime:', Cesium.JulianDate.toIso8601(currentTime), 'canonicalStop:', Cesium.JulianDate.toIso8601(canonicalStop));
            viewer.clock.currentTime = Cesium.JulianDate.clone(canonicalStop);

            // Get final position
            const finalPosition = hikerEntity.position!.getValue(stopTime);
            if (finalPosition && animationPhaseRef.current === AnimationPhase.PLAYING) {
              // Check if outro should be skipped (default: false - outro enabled)
              const skipOutro = (window as any).__SKIP_OUTRO === true;

              if (skipOutro) {
                // Skip outro - transition directly to COMPLETE
                handleSkipOutro(viewer, (phase) => { animationPhaseRef.current = phase; });
              } else {
                // Transition to OUTRO phase using extracted module
                animationPhaseRef.current = AnimationPhase.OUTRO;
                viewer.clock.shouldAnimate = false;

                const outroAnimation = createOutroAnimation({
                  viewer,
                  finalPosition,
                  setAnimationPhase: (phase) => { animationPhaseRef.current = phase; },
                });
                outroAnimation.start();
              }
            }
          }
          return;
        }

        // Use TrackCameraController for camera updates
        const loopInfo: LoopInfo = {
          isLoop: isLoopRouteRef.current,
          centroid: loopCentroidRef.current,
          radius: loopRadiusRef.current,
        };

        const cameraState: CameraState = {
          smoothedHikerPosition: smoothedHikerPositionRef.current,
          smoothedCameraTarget: smoothedCameraTargetRef.current,
          lookAheadTarget: lookAheadTargetRef.current,
          currentRotationAngle: currentRotationAngleRef.current,
          continuousAzimuth: continuousAzimuthRef.current,
          cameraTiltProgress: cameraTiltProgressRef.current,
        };

        const cameraResult = computeCameraUpdate({
          viewer,
          hikerEntity,
          currentTime,
          startTime,
          stopTime,
          loopInfo,
          state: cameraState,
        });

        if (cameraResult) {
          applyCamera(viewer, cameraResult);

          // Update refs with new state
          if (cameraResult.newState.smoothedHikerPosition) {
            smoothedHikerPositionRef.current = cameraResult.newState.smoothedHikerPosition;
          }
          if (cameraResult.newState.smoothedCameraTarget) {
            smoothedCameraTargetRef.current = cameraResult.newState.smoothedCameraTarget;
          }
          if (cameraResult.newState.lookAheadTarget) {
            lookAheadTargetRef.current = cameraResult.newState.lookAheadTarget;
          }
          if (cameraResult.newState.currentRotationAngle !== undefined) {
            currentRotationAngleRef.current = cameraResult.newState.currentRotationAngle;
          }
        }

        // Runtime diagnostic: log nearest sample and distance occasionally
        try {
          const nowMs = performance.now();
          if (nowMs - runtimeLogLastRef.current > 250) { // throttle to 4Hz
            runtimeLogLastRef.current = nowMs;
            // Find nearest sample by time
            let nearestIdx = -1;
            let nearestDiff = Number.POSITIVE_INFINITY;
            for (let i = 0; i < filteredPoints.length; i++) {
              try {
                const t = Cesium.JulianDate.fromIso8601(filteredPoints[i].time);
                const diff = Math.abs(Cesium.JulianDate.secondsDifference(t, currentTime));
                if (diff < nearestDiff) {
                  nearestDiff = diff;
                  nearestIdx = i;
                }
              } catch (e) {}
            }
            if (nearestIdx >= 0) {
              const np = filteredPoints[nearestIdx];
              const npPos = Cesium.Cartesian3.fromDegrees(Number(np.lon), Number(np.lat), Number(np.ele) || 0);
              // Get current hiker position for distance calculation
              const hikerPos = hikerEntity.position.getValue(currentTime);
              if (hikerPos) {
                const distToCurrent = Cesium.Cartesian3.distance(npPos, hikerPos);
                console.log(`RT: current=${Cesium.JulianDate.toIso8601(currentTime)} idx=${nearestIdx} sampleTime=${np.time} lat=${np.lat} lon=${np.lon} ele=${np.ele} dt=${nearestDiff.toFixed(2)}s dist=${(distToCurrent/1000).toFixed(3)}km`);
              }
            }
          }
        } catch (e) {
          // ignore runtime diagnostic errors
        }
      } catch (e) {
        console.error('Error in postRender handler:', e);
      }
    };

    viewer.scene.preRender.addEventListener(preRenderListener);
    viewer.scene.postRender.addEventListener(postRenderListener);
    listenersRef.current = { pre: preRenderListener, post: postRenderListener };

    // Disable screen space camera controller completely to prevent interference
    viewer.scene.screenSpaceCameraController.enableRotate = false;
    viewer.scene.screenSpaceCameraController.enableTranslate = false;
    viewer.scene.screenSpaceCameraController.enableZoom = false;
    viewer.scene.screenSpaceCameraController.enableTilt = false;
    viewer.scene.screenSpaceCameraController.enableLook = false;

    // CRITICAL: Set currentTime to startTime before any animation logic
    // This ensures the hiker starts from the beginning, not the end
    console.log('Setting initial clock state - currentTime to startTime');
    viewer.clock.startTime = Cesium.JulianDate.clone(startTime);
    viewer.clock.stopTime = Cesium.JulianDate.clone(stopTime);
    viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);

    // Start with static camera at working position (looking straight down)
    viewer.clock.shouldAnimate = false;
    if (!(window as any).__MANUAL_MULTIPLIER) {
      viewer.clock.multiplier = 0; // No animation yet
    }
    console.log('Initial clock set: startTime=', Cesium.JulianDate.toIso8601(viewer.clock.startTime), 'stopTime=', Cesium.JulianDate.toIso8601(viewer.clock.stopTime), 'currentTime=', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));

    const startingPosition = hikerEntity.position?.getValue(startTime);

    if (startingPosition && fullRoutePositions.length > 1) {
      // Set initial camera to point at hiker's start position
      try {
        const startTransform = Cesium.Transforms.eastNorthUpToFixedFrame(startingPosition);
        const initialCameraOffset = new Cesium.Cartesian3(-CAMERA.BASE_BACK, 0, CAMERA.BASE_HEIGHT);
        const initialCameraPosition = Cesium.Matrix4.multiplyByPoint(startTransform, initialCameraOffset, new Cesium.Cartesian3());

        viewer.camera.position = initialCameraPosition;

        // Point camera directly at hiker (centered) with no horizontal offset
        const lookAtOffset = new Cesium.Cartesian3(0, 0, CAMERA.BASE_HEIGHT * 0.48);
        viewer.camera.lookAt(startingPosition, lookAtOffset);

        // Initialize smoothing refs with start position
        smoothedCameraTargetRef.current = startingPosition.clone();
        lookAheadTargetRef.current = startingPosition.clone();

        // Calculate initial azimuth if loop route
        if (isLoopRouteRef.current && loopCentroidRef.current) {
          const vectorToCentroid = Cesium.Cartesian3.subtract(
            loopCentroidRef.current,
            startingPosition,
            new Cesium.Cartesian3()
          );
          initialAzimuthRef.current = Math.atan2(vectorToCentroid.y, vectorToCentroid.x) * (180 / Math.PI);
          console.log('Initial azimuth from start to centroid:', initialAzimuthRef.current.toFixed(1), '°');
        }

        console.log('Camera initialized at hiker start position');
      } catch (e) {
        console.warn('Failed to set initial camera position:', e);
      }

      console.log('Camera at working start position, waiting for globe to settle...');

      // Wait 1 second at starting position for globe to settle and mark ready
      setTimeout(() => {
        console.log('Globe settled, marking ready for recording and starting transition');
        (window as any).CESIUM_ANIMATION_READY = true;

        // Diagnostic: dump clock and route time info to help debug immediate end-of-route
        try {
          console.log('--- Globe settle diagnostics ---');
          console.log('Passed startTime:', startTime && Cesium.JulianDate.toIso8601(startTime));
          console.log('Passed stopTime :', stopTime && Cesium.JulianDate.toIso8601(stopTime));
          console.log('Viewer clock startTime:', viewer.clock.startTime && Cesium.JulianDate.toIso8601(viewer.clock.startTime));
          console.log('Viewer clock stopTime :', viewer.clock.stopTime && Cesium.JulianDate.toIso8601(viewer.clock.stopTime));
          console.log('Viewer clock currentTime :', viewer.clock.currentTime && Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
          console.log('Viewer clock shouldAnimate:', !!viewer.clock.shouldAnimate, 'multiplier:', viewer.clock.multiplier);
          console.log('Track points length:', filteredPoints.length);
          if (filteredPoints.length > 0) {
            console.log('First point time:', filteredPoints[0].time, 'Last point time:', filteredPoints[filteredPoints.length - 1].time);
          }
        } catch (e) {
          console.warn('Diagnostics failed at globe settle:', e);
        }

        // If the viewer clock is already at or past stopTime (sometimes due to
        // earlier misconfiguration), clamp it back to startTime to allow playback
        // to proceed from the beginning.
        try {
          const canonicalStop = viewer.clock.stopTime || stopTime;
          if (canonicalStop && Cesium.JulianDate.compare(viewer.clock.currentTime, canonicalStop) >= 0) {
            console.warn('Viewer currentTime is at/after stopTime on settle; resetting to startTime to allow playback');
            viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.startTime || startTime);
          }
        } catch (e) {
          // ignore
        }
        // Get rendering info from browser
        try {
          // Get map provider info
          let mapProvider = 'unknown';
          if (viewer.imageryLayers) {
            const layers = viewer.imageryLayers;
            for (let i = 0; i < layers.length; i++) {
              const layer = layers.get(i);
              if (layer && layer.imageryProvider) {
                const provider = layer.imageryProvider;
                if (provider.constructor.name.includes('IonImageryProvider')) {
                  const ionProvider = provider as any; // Cast to access private properties
                  if (ionProvider._assetId === 2) mapProvider = 'Bing Maps';
                  else if (ionProvider._assetId === 3954) mapProvider = 'Sentinel-2';
                  else mapProvider = `Cesium Ion (${ionProvider._assetId || 'unknown'})`;
                } else if (provider.constructor.name.includes('OpenStreetMap')) {
                  mapProvider = 'OpenStreetMap';
                }
                break;
              }
            }
          }

          // Get terrain quality
          let terrainQuality = 'unknown';
          if (viewer.scene && viewer.scene.globe) {
            const errorValue = viewer.scene.globe.maximumScreenSpaceError;
            if (errorValue !== undefined) {
              const qualityLevel = getTerrainQualityLevel(errorValue);
              terrainQuality = `${errorValue} (${qualityLevel})`;
            } else {
              terrainQuality = 'unknown';
            }
          }

          statusInfo.mapProvider = mapProvider;
          statusInfo.terrainQuality = terrainQuality;
        } catch (e) {
          console.warn('Could not get render info:', e);
        }

        // Initial status display
        displayStatusBar();

        // Start intro animation
        startIntroAnimation();

        console.log('Scheduling RAF for animation start');
        // Intro and outro animations are skipped by default to focus on route animation.
        // Set window.__SKIP_INTRO=false or window.__SKIP_OUTRO=false to enable them.
        const skipIntro = (window as any).__SKIP_INTRO !== false; // default true
        const skipOutro = (window as any).__SKIP_OUTRO !== false; // default true

        // Mark that animation has started to disable preRender early-reset
        animationStartedRef.current = true;

        // Set multiplier and start animation
        console.log('Starting animation with multiplier:', animationSpeed);
        viewer.clock.shouldAnimate = false; // Start paused, will be enabled after intro or immediately

        if (!(window as any).__MANUAL_MULTIPLIER) {
          viewer.clock.multiplier = animationSpeed;
        }

        console.log('Clock configured: shouldAnimate=false (will start after intro), multiplier=', viewer.clock.multiplier);
        console.log('Clock currentTime:', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
        console.log('Clock startTime:', Cesium.JulianDate.toIso8601(viewer.clock.startTime));
        console.log('Clock stopTime:', Cesium.JulianDate.toIso8601(viewer.clock.stopTime));

        if (!skipIntro) {
          // Phase 1: Camera intro animation - duration from config
          let cameraProgress = 0;
          const introSteps = ANIMATION.INTRO_DURATION_SECONDS * 10; // 10 steps per second at 100ms interval
          const cameraInterval = setInterval(() => {
            if (!viewer || viewer.isDestroyed() || !viewer.clock) {
              clearInterval(cameraInterval);
              return;
            }

            cameraProgress += 1 / introSteps;

            // Add subtle side-to-side panning during opening (sine wave: -200 to +200)
            cameraPanOffsetRef.current = Math.sin(cameraProgress * Math.PI * 2) * 200;

            // Keep clock at slow speed during intro for smooth camera movement
            if (!(window as any).__MANUAL_MULTIPLIER) {
              viewer.clock.multiplier = 1; // Fixed 1x speed for intro
            }

            if (cameraProgress >= 1) {
              cameraAzimuthProgressRef.current = 1;
              cameraTiltProgressRef.current = 1;
              clearInterval(cameraInterval);
              console.log('Camera intro complete, ramping up to route speed:', animationSpeed + 'x');

              // Signal that the intro animation completed so external camera logic
              // (e.g. useCesiumCamera) can enable the tracked-entity mode safely.
              try {
                (window as any).CESIUM_INTRO_COMPLETE = true;
                console.log('✅ CESIUM_INTRO_COMPLETE flag set');
              } catch (e) {
                // ignore
              }

              // Phase 2: Set full route speed immediately (skip ramping for constant speed)
              if (!(window as any).__MANUAL_MULTIPLIER) {
                viewer.clock.multiplier = animationSpeed;
              }
              animationPhaseRef.current = AnimationPhase.PLAYING; // Intro complete
              console.log(`Route animation at full speed: ${animationSpeed}x`);

              // Start continuous slow azimuth rotation during main route
              azimuthRotationIntervalRef.current = setInterval(() => {
                const phase = animationPhaseRef.current;
                if (!viewer || viewer.isDestroyed() || phase === AnimationPhase.OUTRO || phase === AnimationPhase.COMPLETE || !viewer.clock || !viewer.clock.shouldAnimate) {
                  if (azimuthRotationIntervalRef.current) {
                    clearInterval(azimuthRotationIntervalRef.current);
                    azimuthRotationIntervalRef.current = null;
                  }
                  return;
                }

                // Rotate slowly: 360° over ~2 minutes = 0.05°/frame at 10fps
                continuousAzimuthRef.current += 0.05;
                if (continuousAzimuthRef.current >= 360) {
                  continuousAzimuthRef.current = 0;
                }
              }, 100);

              // Monitor for route completion
              checkCompletionIntervalRef.current = setInterval(() => {
                if (!viewer || viewer.isDestroyed() || !viewer.clock || !viewer.clock.shouldAnimate) {
                  if (checkCompletionIntervalRef.current) {
                    clearInterval(checkCompletionIntervalRef.current);
                    checkCompletionIntervalRef.current = null;
                  }
                  return;
                }

                const currentTime = viewer.clock.currentTime;
                const timeRemaining = Cesium.JulianDate.secondsDifference(stopTime, currentTime);

                // The postRenderListener will handle route ending naturally
              }, 100);
            } else {
              // During camera animation: update both azimuth and tilt simultaneously
              // Custom ease in-out with extra gentle start to eliminate jerk
              let eased;
              if (cameraProgress < 0.5) {
                // Ease in: use quartic (x^4) for extremely gentle start
                const t = cameraProgress * 2;
                eased = t * t * t * t / 2;
              } else {
                // Ease out: use quartic for gentle end
                const t = (cameraProgress - 0.5) * 2;
                eased = 0.5 + (1 - Math.pow(1 - t, 4)) / 2;
              }

              // Apply same easing to both azimuth and tilt
              cameraAzimuthProgressRef.current = eased;
              cameraTiltProgressRef.current = eased;
            }
          }, 100);
        } else {
          // If skipping intro, mark intro complete immediately and start main rotation
          console.log('Skipping intro - setting camera to final positions');
          try { (window as any).CESIUM_INTRO_COMPLETE = true; } catch (e) {}
          animationPhaseRef.current = AnimationPhase.PLAYING;
          // Set camera progress to final positions for immediate main animation view
          cameraAzimuthProgressRef.current = 1;
          cameraTiltProgressRef.current = 1;
          console.log('Camera refs set: azimuth=', cameraAzimuthProgressRef.current, 'tilt=', cameraTiltProgressRef.current, 'phase=', animationPhaseRef.current);
          azimuthRotationIntervalRef.current = setInterval(() => {
            const phase = animationPhaseRef.current;
            if (!viewer || viewer.isDestroyed() || phase === AnimationPhase.OUTRO || phase === AnimationPhase.COMPLETE || !viewer.clock || !viewer.clock.shouldAnimate) {
              if (azimuthRotationIntervalRef.current) { clearInterval(azimuthRotationIntervalRef.current); azimuthRotationIntervalRef.current = null; }
              return;
            }
            continuousAzimuthRef.current += 0.05; if (continuousAzimuthRef.current >= 360) continuousAzimuthRef.current = 0;
          }, 100);
        }
      }, ANIMATION.SETTLE_DURATION_SECONDS * 1000);
    } else {
      // Fallback
      setTimeout(() => {
        if (viewer && !viewer.isDestroyed() && viewer.clock) {
          viewer.clock.shouldAnimate = true;
          viewer.clock.multiplier = animationSpeed;
          (window as any).CESIUM_ANIMATION_READY = true;
        }
      }, 4000);
    }

    console.log('Animation setup complete, starting camera tilt animation...');

    // Start periodic status display (every 5 seconds)
    const statusInterval = setInterval(() => {
      if (statusInfo.startTime && animationPhaseRef.current === AnimationPhase.PLAYING) {
        displayStatusBar();
      }
    }, 5000);

    // Clear status interval on cleanup
    const cleanup = () => {
      clearInterval(statusInterval);
      if (azimuthRotationIntervalRef.current) {
        clearInterval(azimuthRotationIntervalRef.current);
        azimuthRotationIntervalRef.current = null;
      }
      if (checkCompletionIntervalRef.current) {
        clearInterval(checkCompletionIntervalRef.current);
        checkCompletionIntervalRef.current = null;
      }
    };

    // Store cleanup function
    (window as any).animationCleanup = cleanup;
    }; // End of initializeAnimation

    // Initialize camera refs for intro animation
    animationPhaseRef.current = AnimationPhase.INTRO;
    cameraAzimuthProgressRef.current = 0;
    cameraTiltProgressRef.current = 0;
    console.log('Pre-init camera refs for intro animation: azimuth=0, tilt=0, isInitial=true');

    // Start animation immediately - postRenderListener will position camera correctly
    console.log('Starting animation sequence');
    initializeAnimation();

    return () => {
      if (listenersRef.current) {
        viewer.scene.preRender.removeEventListener(listenersRef.current.pre);
        viewer.scene.postRender.removeEventListener(listenersRef.current.post);
      }
      if (entitiesRef.current.hiker) {
        viewer.entities.remove(entitiesRef.current.hiker);
      }
      if (entitiesRef.current.trail) {
        viewer.entities.remove(entitiesRef.current.trail);
      }

      // Clear intervals
      if (azimuthRotationIntervalRef.current) {
        clearInterval(azimuthRotationIntervalRef.current);
        azimuthRotationIntervalRef.current = null;
      }
      if (checkCompletionIntervalRef.current) {
        clearInterval(checkCompletionIntervalRef.current);
        checkCompletionIntervalRef.current = null;
      }

      // Call animation cleanup if it exists
      if ((window as any).animationCleanup) {
        (window as any).animationCleanup();
      }

      // Re-enable camera controller on cleanup
      viewer.scene.screenSpaceCameraController.enableRotate = true;
      viewer.scene.screenSpaceCameraController.enableTranslate = true;
      viewer.scene.screenSpaceCameraController.enableZoom = true;
      viewer.scene.screenSpaceCameraController.enableTilt = true;
      viewer.scene.screenSpaceCameraController.enableLook = true;
    };
  }, [viewer, trackPoints, startTime, stopTime, animationSpeed]);

  return entity;
}