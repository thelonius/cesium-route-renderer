import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { TrackPoint } from '../types';
import { detectLoop, getLazyCameraTarget } from '../services/camera/utils/loopDetector';

// Import constants from central config
import constants from '../../config/constants';
const { CAMERA, ANIMATION } = constants;

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

// Get build version
function getBuildVersion() {
  try {
    // In development, return dev version
    return 'dev';
  } catch (err) {
    return 'unknown';
  }
}

// Display status bar in console
function displayStatusBar() {
  const averageFrameTime = statusInfo.frameTimes.length > 0
    ? statusInfo.frameTimes.reduce((a, b) => a + b, 0) / statusInfo.frameTimes.length
    : 0;

  console.log(`📊 [${statusInfo.buildVersion}] FPS:${statusInfo.averageFps.toFixed(1)} | Map:${statusInfo.mapProvider} | Terrain:${statusInfo.terrainQuality} | Speed:${statusInfo.animationSpeed}x | Frame:${averageFrameTime.toFixed(2)}ms`);
}

// Convert terrain quality value to descriptive level
function getTerrainQualityLevel(errorValue: number): string {
  if (errorValue <= 1) return 'Ultra High';
  if (errorValue <= 2) return 'High';
  if (errorValue <= 4) return 'Medium';
  if (errorValue <= 8) return 'Low';
  if (errorValue <= 16) return 'Very Low';
  return 'Minimal';
}

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
  const isInitialAnimationRef = useRef(true); // Track if we're still in opening animation
  const isEndingAnimationRef = useRef(false); // Track if we're in ending animation
  const continuousAzimuthRef = useRef(0); // Continuous slow rotation during main route
  const cameraPanOffsetRef = useRef(0); // Side-to-side panning offset
  const azimuthRotationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkCompletionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const manualStepEnabledRef = useRef(false);
  const lastManualStepTimeRef = useRef<number | null>(null);
  const savedMultiplierRef = useRef<number | null>(null);
  const manualStepLogCounterRef = useRef(0);
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
    isInitialAnimationRef.current = true;
    isEndingAnimationRef.current = false;
    continuousAzimuthRef.current = 0;
    cameraPanOffsetRef.current = 0;
    trailPositionsRef.current = [];
    dlog('Animation state reset for new route');

    const initializeAnimation = () => {
      // Initialize status tracking
      statusInfo.buildVersion = getBuildVersion();
      statusInfo.animationSpeed = animationSpeed;
      statusInfo.startTime = Date.now();
      statusInfo.frameCount = 0;
      statusInfo.lastFrameTime = performance.now();
      statusInfo.frameTimes = [];

      // Initialize lastAddedTimeRef
      lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);

      // Configure the clock for animation (will be overridden by speed easing later)
      viewer.clock.startTime = Cesium.JulianDate.clone(startTime);
      viewer.clock.stopTime = Cesium.JulianDate.clone(stopTime);
      viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
      viewer.clock.clockRange = Cesium.ClockRange.CLAMPED; // Don't loop - stop at end
      // Use tick-dependent stepping so the clock advances by multiplier on each render
      // tick instead of being tied to the host system clock. This prevents sudden
      // jumps when start/stop are in the past relative to system time.
      viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT; // Use multiplier for speed control
      dlog('Clock step set to TICK_DEPENDENT to avoid system-time jumps');
      // Apply desired multiplier now (unless user requested manual override).
      // Earlier code waited until the intro completed to set multiplier; setting it
      // here makes the requested speed available immediately (the intro will
      // still clamp to 1x while running). The manual override (`__MANUAL_MULTIPLIER`)
      // prevents the hook from changing the multiplier when a user wants to control it.
      if (!(window as any).__MANUAL_MULTIPLIER) {
        try {
          viewer.clock.multiplier = animationSpeed;
        } catch (e) {
          // Ignore if viewer or clock isn't ready to accept multiplier yet
        }
      }

      // Ensure the configured stopTime is greater than startTime. Some GPX/KML
      // sources may produce zero-length ranges (start == stop) which causes the
      // animation to immediately consider the route finished. Synthesize a
      // small stopTime based on number of points when that happens.
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
      console.log(`Animation will start with speed easing`);

    // TEMPORARILY DISABLED: Filtering was causing "cartesian is required" errors
    // TODO: Re-enable with better filtering logic that ensures enough points remain
    /*
    // Filter and simplify track points to reduce jerkiness
    const filterTrackPoints = (points: TrackPoint[]) => {
      if (points.length < 3) return points;

      const filtered: TrackPoint[] = [points[0]]; // Always keep first point
      const DISTANCE_THRESHOLD = 5; // meters - skip points closer than this
      const TIME_THRESHOLD = 5; // seconds - minimum time between points

      for (let i = 1; i < points.length - 1; i++) {
        const prev = filtered[filtered.length - 1];
        const curr = points[i];

        // Calculate distance from last kept point
        const R = 6371000; // Earth radius in meters
        const lat1 = prev.lat * Math.PI / 180;
        const lat2 = curr.lat * Math.PI / 180;
        const deltaLat = (curr.lat - prev.lat) * Math.PI / 180;
        const deltaLon = (curr.lon - prev.lon) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        // Calculate time difference
        const prevTime = new Date(prev.time).getTime();
        const currTime = new Date(curr.time).getTime();
        const timeDiff = (currTime - prevTime) / 1000;

        // Keep point if it's far enough OR enough time has passed
        if (distance >= DISTANCE_THRESHOLD || timeDiff >= TIME_THRESHOLD) {
          filtered.push(curr);
        }
      }

      filtered.push(points[points.length - 1]); // Always keep last point

      console.log(`Filtered track points: ${points.length} -> ${filtered.length}`);
      return filtered;
    };

    const filteredPoints = filterTrackPoints(trackPoints);
    */

    // Use original track points without filtering to avoid interpolation issues
    const filteredPoints = trackPoints;

    // Diagnostic: log basic info about the provided points
    try {
      console.log(`Track points: ${filteredPoints.length}`);
      if (filteredPoints.length > 0) {
        console.log('First point time:', filteredPoints[0].time, 'Last point time:', filteredPoints[filteredPoints.length - 1].time);
      }
    } catch (e) {
      // ignore diagnostics failures
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

    // Diagnostics: inspect track point timestamps and coordinates to detect
    // any malformed or non-monotonic data that could cause teleportation.
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

    // Create entity for the hiker
    const hikerEntity = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startTime, stop: stopTime })
      ]),
      position: hikerPositions,
      point: {
        pixelSize: 12,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: (() => {
          const userName = new URLSearchParams(window.location.search).get('userName') || 'Hiker';
          // Easter egg for Mikael 🎉
          if (userName.toLowerCase().includes('mikael') || userName.toLowerCase().includes('ayrapetyan')) {
            return 'Микаэл, джан, дорогой!';
          }
          return userName;
        })(),
        font: '14pt sans-serif',
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
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

    if (fullRoutePositions.length > 1) {
      viewer.entities.add({
        polyline: {
          positions: fullRoutePositions,
          width: 3,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.WHITE.withAlpha(0.5),
            outlineWidth: 1,
            outlineColor: Cesium.Color.BLUE.withAlpha(0.3)
          }),
          clampToGround: true
        }
      });
    }

    // Create dynamic trail with reduced artifacts
    const trailEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailPositionsRef.current, false),
        width: 4, // Reduced from 5 to minimize rendering artifacts
        material: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.9)), // Slight transparency to reduce artifacts
        depthFailMaterial: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.5)),
        clampToGround: true,
        show: true
      }
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
      }
    } catch (e) {
      console.warn('Loop detection failed:', e);
    }

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
        // ONLY reset if animation hasn't started yet to avoid fighting manual-step.
        try {
          const canonicalStopEarly = viewer.clock.stopTime || stopTime;
          if (!animationStartedRef.current && preRenderFrameCounter.current < 10 && Cesium.JulianDate.compare(currentTime, canonicalStopEarly) >= 0) {
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
          if ((window as any).__ENABLE_TRAIL_RESET) {
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

        // Check for large gaps or time jumps to prevent lines across the globe
        if (trailPositionsRef.current.length > 0) {
          const lastPosition = trailPositionsRef.current[trailPositionsRef.current.length - 1];
          const distance = Cesium.Cartesian3.distance(lastPosition, currentPosition);
          const GAP_THRESHOLD = 5000; // 5km - if points are farther apart, reset trail

          // Also check for large time jumps (seeking/pausing)
          const timeJump = Math.abs(dt);
          // Scale threshold based on animation speed to handle high-speed playback
          const speedMultiplier = animationSpeed || 2;
          const TIME_JUMP_THRESHOLD = Math.max(30, speedMultiplier / 2); // Adaptive threshold

          if (distance > GAP_THRESHOLD || timeJump > TIME_JUMP_THRESHOLD) {
            // Only log in non-Docker mode to avoid log spam during recording
            const isDocker = new URLSearchParams(window.location.search).get('docker') === 'true';
            if (!isDocker) {
              if (distance > GAP_THRESHOLD) {
                try { console.log(`Large gap detected (${(distance/1000).toFixed(1)}km) at time ${Cesium.JulianDate.toIso8601(currentTime)}, resetting trail`); } catch (e) { console.log(`Large gap detected (${(distance/1000).toFixed(1)}km), resetting trail`); }
              }
              if (timeJump > TIME_JUMP_THRESHOLD) {
                console.log(`Time jump detected (${timeJump.toFixed(1)}s), resetting trail`);
              }
            }

            // Extra diagnostics: determine nearest sample to currentTime and log its coords
            try {
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
                const distToCurrent = Cesium.Cartesian3.distance(npPos, currentPosition);
                console.log(`Nearest sample idx=${nearestIdx} time=${np.time} lat=${np.lat} lon=${np.lon} ele=${np.ele} (dt=${nearestDiff}s) distToCurrent=${(distToCurrent/1000).toFixed(3)}km`);
              }
            } catch (e) {
              console.warn('Nearest-sample diagnostics failed:', e);
            }

            // Respect runtime flag before clearing the trail. Default is OFF to preserve history.
            if ((window as any).__ENABLE_TRAIL_RESET) {
              trailPositionsRef.current = [];
            } else {
              // Keep trail; optionally you could start a new segment here instead
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
        // if (trailPositionsRef.current.length > MAX_TRAIL_POINTS) {
        //   trailPositionsRef.current.shift();
        // }

        lastAddedTimeRef.current = Cesium.JulianDate.clone(currentTime);
      } catch (err) {
        console.error('Error in preRender handler:', err);
      }
    };

    const postRenderListener = () => {
      try {
      dlog('postRender called, clock shouldAnimate=', viewer.clock.shouldAnimate, 'multiplier=', viewer.clock.multiplier, 'currentTime=', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
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

        // Manual per-frame clock stepping for high-speed playback
        if (manualStepEnabledRef.current && viewer && viewer.clock && !isEndingAnimationRef.current) {
          try {
            const canonicalStop = viewer.clock.stopTime || stopTime;
            const routeDurationSeconds = Cesium.JulianDate.secondsDifference(canonicalStop, viewer.clock.startTime || startTime);
            const targetFPS = 30; // Target frames per second for smooth animation
            // Calculate per-frame advance: route duration / (target FPS * expected render seconds)
            // For a route of X seconds at multiplier M, we want to render it in X/M seconds at targetFPS
            const expectedRenderSeconds = routeDurationSeconds / (savedMultiplierRef.current || 1200);
            const totalFrames = targetFPS * expectedRenderSeconds;
            const advanceSecondsPerFrame = routeDurationSeconds / totalFrames;

            // Add the advance
            const currentTime = viewer.clock.currentTime;
            const newTime = Cesium.JulianDate.addSeconds(currentTime, advanceSecondsPerFrame, new Cesium.JulianDate());

            if (manualStepLogCounterRef.current < 8) {
              try {
                console.log('ManualStep:', {
                  routeDuration: routeDurationSeconds.toFixed(1),
                  multiplier: savedMultiplierRef.current,
                  expectedRenderSec: expectedRenderSeconds.toFixed(2),
                  totalFrames: totalFrames.toFixed(0),
                  advancePerFrame: advanceSecondsPerFrame.toFixed(3),
                  newTime: Cesium.JulianDate.toIso8601(newTime),
                  stop: canonicalStop && Cesium.JulianDate.toIso8601(canonicalStop)
                });
              } catch (e) {}
              manualStepLogCounterRef.current += 1;
            }

            // Instead of clamping directly to stopTime (which triggers preRender reset),
            // advance to just before stopTime and let postRender route-end logic finish.
            if (Cesium.JulianDate.compare(newTime, canonicalStop) >= 0) {
              const remaining = Cesium.JulianDate.secondsDifference(canonicalStop, currentTime);
              if (remaining <= 0.5) {
                // Very close to end: advance to stopTime and let route-end logic finish
                safeSetCurrentTime(canonicalStop, 'manual-step final->stop');
              } else {
                // Advance to 0.3s before stop to avoid overshoot
                const nearStop = Cesium.JulianDate.addSeconds(canonicalStop, -0.3, new Cesium.JulianDate());
                safeSetCurrentTime(nearStop, 'manual-step clamp-near-stop');
              }
            } else {
              safeSetCurrentTime(newTime, 'manual-step advance');
            }
          } catch (e) {
            console.warn('Manual stepping failed:', e);
          }
        }

        // Stop controlling camera during ending animation
        if (isEndingAnimationRef.current) return;

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
            if (finalPosition && !isEndingAnimationRef.current) {
              isEndingAnimationRef.current = true;

              // Check if outro should be skipped (default: true)
              const skipOutro = (window as any).__SKIP_OUTRO !== false;
              if (skipOutro) {
                // Fast-path: skip outro animation and mark complete
                // Keep animation running so recorder can capture final frames
                viewer.clock.shouldAnimate = false; // Stop clock since route is complete
                (window as any).CESIUM_ANIMATION_COMPLETE = true;
                console.log('✅ Route ended - CESIUM_ANIMATION_COMPLETE flag set (outro skipped)');
                displayStatusBar();
              } else {
                // Outro animation enabled - capture multiplier and start camera animation
                const savedMultiplier = viewer.clock.multiplier;
                viewer.clock.shouldAnimate = false; // stop automatic advancement; outro will animate camera manually
                console.log('✅ Route ended - starting outro');
                // Outro runs at FIXED real-time speed (duration from config)
                console.log(`Starting outro at fixed 1x speed (${ANIMATION.OUTRO_DURATION_SECONDS} seconds)`);
                // Ensure outro runs at real-time speed on the clock while we animate camera
                try { viewer.clock.multiplier = 1; } catch (e) {}

                let outroProgress = 0;
                const outroSteps = ANIMATION.OUTRO_DURATION_SECONDS * 10; // 10 steps per second at 100ms interval

                // Capture initial camera state to maintain view angle
                const initialDistance = Cesium.Cartesian3.distance(viewer.camera.position, finalPosition);
                const initialOffset = Cesium.Cartesian3.subtract(viewer.camera.position, finalPosition, new Cesium.Cartesian3());

                const outroInterval = setInterval(() => {
                  if (!viewer || viewer.isDestroyed() || outroProgress >= 1) {
                    clearInterval(outroInterval);
                    if (outroProgress >= 1) {
                      console.log('🎬 Outro complete');
                      // Restore previous multiplier and stop animation
                      try {
                        if (typeof savedMultiplier !== 'undefined' && viewer && viewer.clock) {
                          viewer.clock.multiplier = savedMultiplier;
                        }
                        viewer.clock.shouldAnimate = false;
                      } catch (e) {}

                      (window as any).CESIUM_ANIMATION_COMPLETE = true;
                      console.log('✅ CESIUM_ANIMATION_COMPLETE flag set');

                      // Reset camera lookAt transform so we don't leave the camera locked
                      try {
                        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
                      } catch (e) {}

                      // Final status display
                      displayStatusBar();
                    }
                    return;
                  }

                  outroProgress += 1 / outroSteps;
                  const eased = 1 - Math.pow(1 - outroProgress, 3); // Cubic ease-out

                  // Move camera outward only, keeping view angle constant
                  // Scale distance by factor of 3 (1x to 3x) with easing
                  const distanceScale = 1 + (2 * eased);
                  const newOffset = Cesium.Cartesian3.multiplyByScalar(initialOffset, distanceScale, new Cesium.Cartesian3());
                  const newPosition = Cesium.Cartesian3.add(finalPosition, newOffset, new Cesium.Cartesian3());

                  // Position camera explicitly and use the computed offset for lookAt
                  try {
                    viewer.camera.position = newPosition;
                    viewer.camera.lookAt(finalPosition, newOffset);
                  } catch (e) {
                    console.warn('Outro camera update failed:', e);
                  }
                }, 100);
              }
            }
          }
          return;
        }

        const position = hikerEntity.position.getValue(currentTime);
        if (!position || !position.x || !Cesium.Cartesian3.equals(position, position)) {
          console.warn('Invalid hiker position at time:', currentTime);
          return;
        }

        // Apply gentle smoothing (less lazy, more responsive)
        const smoothedPosition = getLazyCameraTarget(
          position,
          smoothedCameraTargetRef.current,
          isLoopRouteRef.current ? 30 : 20, // Lower threshold = more responsive
          isLoopRouteRef.current ? 0.75 : 0.65 // Less smoothing = follows hiker more closely
        );
        smoothedCameraTargetRef.current = smoothedPosition;

        // For loop routes: camera follows hiker but looks toward centroid
        // Calculate blend between hiker and centroid for camera look-at target
        let cameraLookAtTarget = smoothedPosition;
        
        if (isLoopRouteRef.current && loopCentroidRef.current) {
          // Blend: 70% centroid + 30% hiker position for smooth centroid-oriented view
          cameraLookAtTarget = Cesium.Cartesian3.lerp(
            smoothedPosition,
            loopCentroidRef.current,
            0.7,
            new Cesium.Cartesian3()
          );
        }

        const transform = Cesium.Transforms.eastNorthUpToFixedFrame(smoothedPosition);

        // Calculate camera offset based on route type
        let cameraOffsetDistance = CAMERA.BASE_BACK;
        let cameraOffsetHeight = CAMERA.BASE_HEIGHT;

        if (isLoopRouteRef.current && loopCentroidRef.current) {
          // For loop routes: moderate distance to see loop while following hiker
          cameraOffsetDistance = Math.min(loopRadiusRef.current * 1.5, CAMERA.BASE_BACK * 2);
          cameraOffsetHeight = Math.min(loopRadiusRef.current * 1.2, CAMERA.BASE_HEIGHT * 1.5);
        }

        // Use constant camera position (with route-aware adjustments)
        const cameraOffsetLocal = new Cesium.Cartesian3(-cameraOffsetDistance, 0, cameraOffsetHeight);
        const cameraPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3());

        // Validate camera position
        if (!cameraPosition || !Cesium.Cartesian3.equals(cameraPosition, cameraPosition)) {
          console.warn('Invalid camera position calculated');
          return;
        }

        try {
          viewer.camera.position = cameraPosition;
          if (position) {
            if (isInitialAnimationRef.current || isEndingAnimationRef.current) {
              // During opening/ending animation: interpolate azimuth and tilt smoothly with panning
              const azimuth = cameraAzimuthProgressRef.current;
              const tilt = cameraTiltProgressRef.current;
              const panOffset = cameraPanOffsetRef.current;

              // Interpolate heading (azimuth): 0° → 25°
              const targetHeading = 25; // degrees
              const currentHeading = targetHeading * azimuth;

              // Interpolate lookAt offset for tilt with panning
              // Start: looking straight down (0, 0, height)
              // End: looking forward/behind (-BASE_BACK, 0, BASE_HEIGHT)
              const lookAtOffsetX = -cameraOffsetDistance * tilt;
              const lookAtOffsetY = panOffset; // Side-to-side panning
              const lookAtOffsetZ = cameraOffsetHeight * 0.48; // scaled forward look-at height

              // Apply heading rotation to lookAt offset
              const headingRadians = Cesium.Math.toRadians(currentHeading);
              const rotatedX = lookAtOffsetX * Math.cos(headingRadians) - lookAtOffsetY * Math.sin(headingRadians);
              const rotatedY = lookAtOffsetX * Math.sin(headingRadians) + lookAtOffsetY * Math.cos(headingRadians);

              const lookAtOffset = new Cesium.Cartesian3(rotatedX, rotatedY, lookAtOffsetZ);
              viewer.camera.lookAt(cameraLookAtTarget, lookAtOffset);
            } else {
              // Normal follow camera with continuous slow azimuth rotation
              // For loop routes: gentler continuous panning around the centroid
              const baseHeading = 25; // Base heading in degrees
              const continuousRotation = continuousAzimuthRef.current; // Slow continuous rotation
              const totalHeading = baseHeading + continuousRotation;

              const headingRadians = Cesium.Math.toRadians(totalHeading);
              const baseOffsetX = -cameraOffsetDistance;
              const baseOffsetY = 0;
              const rotatedX = baseOffsetX * Math.cos(headingRadians) - baseOffsetY * Math.sin(headingRadians);
              const rotatedY = baseOffsetX * Math.sin(headingRadians) + baseOffsetY * Math.cos(headingRadians);

              const lookAtOffset = new Cesium.Cartesian3(rotatedX, rotatedY, cameraOffsetHeight * 0.48);
              viewer.camera.lookAt(cameraLookAtTarget, lookAtOffset);
            }
          }
        } catch (e) {
          console.warn('Camera update failed:', e);
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
              const distToCurrent = Cesium.Cartesian3.distance(npPos, position);
              console.log(`RT: current=${Cesium.JulianDate.toIso8601(currentTime)} idx=${nearestIdx} sampleTime=${np.time} lat=${np.lat} lon=${np.lon} ele=${np.ele} dt=${nearestDiff.toFixed(2)}s dist=${(distToCurrent/1000).toFixed(3)}km`);
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

        console.log('Scheduling RAF for animation start');
        // Intro and outro animations are skipped by default to focus on route animation.
        // Set window.__SKIP_INTRO=false or window.__SKIP_OUTRO=false to enable them.
        const skipIntro = (window as any).__SKIP_INTRO !== false; // default true
        const skipOutro = (window as any).__SKIP_OUTRO !== false; // default true

        // Start route movement safely. Begin with clock paused to avoid large
        // jumps caused by multiplier * elapsedTime during the settle period.
        viewer.clock.shouldAnimate = false;

        const manualSteppingThreshold = 100; // speeds above this use manual stepping
        // Enable manual stepping only when forced or when running in headless/docker mode
        manualStepEnabledRef.current = forceManualStepping || (isHeadless && animationSpeed > manualSteppingThreshold);
        dlog('Preparing to start animation (skipIntro=', skipIntro, ', manualStep=', manualStepEnabledRef.current, ')');

        // Mark that animation has started to disable preRender early-reset
        animationStartedRef.current = true;

        if (manualStepEnabledRef.current) {
          // Manual stepping: save desired multiplier and step the clock per frame
          savedMultiplierRef.current = animationSpeed;
          viewer.clock.multiplier = 1;
          // Ensure Cesium continues rendering frames so our postRender stepping runs
          try { viewer.clock.shouldAnimate = true; } catch (e) {}
          // CRITICAL: Reset currentTime to startTime to begin animation from the start
          safeSetCurrentTime(viewer.clock.startTime || startTime, 'manual-step init');
          lastManualStepTimeRef.current = performance.now();
          console.log('Manual per-frame stepping enabled; savedMultiplier=', savedMultiplierRef.current, 'starting at', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
        } else {
          // Automatic stepping: set multiplier and start immediately
          console.log('Starting automatic stepping, setting multiplier to', animationSpeed);
          try {
            if (!(window as any).__MANUAL_MULTIPLIER) {
              viewer.clock.multiplier = animationSpeed;
            }
            viewer.clock.shouldAnimate = true;
            console.log('Clock started: shouldAnimate=true, multiplier=', viewer.clock.multiplier);
            console.log('Clock currentTime:', Cesium.JulianDate.toIso8601(viewer.clock.currentTime));
            console.log('Clock startTime:', Cesium.JulianDate.toIso8601(viewer.clock.startTime));
            console.log('Clock stopTime:', Cesium.JulianDate.toIso8601(viewer.clock.stopTime));
          } catch (e) {
            console.warn('Failed to start animation:', e);
          }
        }

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
              isInitialAnimationRef.current = false; // Initial animation complete
              console.log(`Route animation at full speed: ${animationSpeed}x`);

              // Start continuous slow azimuth rotation during main route
              azimuthRotationIntervalRef.current = setInterval(() => {
                if (!viewer || viewer.isDestroyed() || isEndingAnimationRef.current || !viewer.clock || !viewer.clock.shouldAnimate) {
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
          isInitialAnimationRef.current = false;
          // Set camera progress to final positions for immediate main animation view
          cameraAzimuthProgressRef.current = 1;
          cameraTiltProgressRef.current = 1;
          console.log('Camera refs set: azimuth=', cameraAzimuthProgressRef.current, 'tilt=', cameraTiltProgressRef.current, 'isInitial=', isInitialAnimationRef.current);
          azimuthRotationIntervalRef.current = setInterval(() => {
            if (!viewer || viewer.isDestroyed() || isEndingAnimationRef.current || !viewer.clock || !viewer.clock.shouldAnimate) {
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
      if (statusInfo.startTime && !isEndingAnimationRef.current) {
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

    // Initialize camera refs to skip intro by default
    const skipIntro = (window as any).__SKIP_INTRO !== false; // default true
    if (skipIntro) {
      // Skip intro: set camera to final positions immediately (before settle timeout)
      isInitialAnimationRef.current = false;
      cameraAzimuthProgressRef.current = 1;
      cameraTiltProgressRef.current = 1;
      console.log('Pre-init camera refs for skipped intro: azimuth=1, tilt=1, isInitial=false');
    } else {
      // Do intro: start with camera looking down
      isInitialAnimationRef.current = true;
      cameraAzimuthProgressRef.current = 0;
      cameraTiltProgressRef.current = 0;
      console.log('Pre-init camera refs for intro animation: azimuth=0, tilt=0, isInitial=true');
    }

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