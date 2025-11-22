import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { TrackPoint } from '../types';

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

const CAMERA_BASE_BACK = 2000; // Camera distance in meters (~2km)
const CAMERA_BASE_HEIGHT = 1000; // Camera height proportional to distance
const CAMERA_SMOOTH_ALPHA = 0.15;
const ADD_INTERVAL_SECONDS = 2.0; // Increased to reduce trail artifacts at lower animation speeds
const MAX_TRAIL_POINTS = 100; // Reduced to minimize trail rendering artifacts on CPU

export default function useCesiumAnimation({
  viewer,
  trackPoints,
  startTime,
  stopTime,
  animationSpeed = 2 // Reduced to 2x for better quality and smoother playback
}: UseCesiumAnimationProps) {

  const trailPositionsRef = useRef<Cesium.Cartesian3[]>([]);
  const lastAddedTimeRef = useRef<Cesium.JulianDate | null>(null);
  const smoothedBackRef = useRef(CAMERA_BASE_BACK);
  const smoothedHeightRef = useRef(CAMERA_BASE_HEIGHT);
  const cameraAzimuthProgressRef = useRef(0); // 0 = no rotation, 1 = full azimuth (for opening)
  const cameraTiltProgressRef = useRef(0); // 0 = looking down, 1 = fully tilted
  const isInitialAnimationRef = useRef(true); // Track if we're still in opening animation
  const isEndingAnimationRef = useRef(false); // Track if we're in ending animation
  const continuousAzimuthRef = useRef(0); // Continuous slow rotation during main route
  const cameraPanOffsetRef = useRef(0); // Side-to-side panning offset
  const azimuthRotationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkCompletionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [entity, setEntity] = useState<Cesium.Entity | null>(null);
  const listenersRef = useRef<{ pre: any; post: any } | null>(null);
  const entitiesRef = useRef<{ hiker: Cesium.Entity | null; trail: Cesium.Entity | null }>({ hiker: null, trail: null });

  useEffect(() => {
    if (!viewer || !trackPoints.length || !startTime || !stopTime) return;

    // Reset animation state for new route
    cameraAzimuthProgressRef.current = 0;
    cameraTiltProgressRef.current = 0;
    isInitialAnimationRef.current = true;
    isEndingAnimationRef.current = false;
    continuousAzimuthRef.current = 0;
    cameraPanOffsetRef.current = 0;
    trailPositionsRef.current = [];
    console.log('Animation state reset for new route');

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
      viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER; // Use multiplier for speed control
      // Don't set multiplier or shouldAnimate here - will be set by speed easing

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

    // Setup camera tracking
    const preRenderListener = () => {
      try {
        // Stop updating trail during ending animation
        if (isEndingAnimationRef.current) return;

        if (!hikerEntity || !hikerEntity.position || !lastAddedTimeRef.current) return;
        const currentTime = viewer.clock.currentTime;

        // Reset trail when animation loops
        if (Cesium.JulianDate.compare(currentTime, lastAddedTimeRef.current) < 0) {
          trailPositionsRef.current = [];
          lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);
          return;
        }

        const currentPosition = hikerEntity.position.getValue(currentTime);
        if (!currentPosition) return;

        const dt = Cesium.JulianDate.secondsDifference(currentTime, lastAddedTimeRef.current);
        if (dt < ADD_INTERVAL_SECONDS && trailPositionsRef.current.length > 0) return;

        // Check for large gaps or time jumps to prevent lines across the globe
        if (trailPositionsRef.current.length > 0) {
          const lastPosition = trailPositionsRef.current[trailPositionsRef.current.length - 1];
          const distance = Cesium.Cartesian3.distance(lastPosition, currentPosition);
          const GAP_THRESHOLD = 5000; // 5km - if points are farther apart, reset trail

          // Also check for large time jumps (seeking/pausing)
          const timeJump = Math.abs(dt);
          const TIME_JUMP_THRESHOLD = 30; // 30 seconds - increased for slow software rendering

          if (distance > GAP_THRESHOLD || timeJump > TIME_JUMP_THRESHOLD) {
            // Only log in non-Docker mode to avoid log spam during recording
            const isDocker = new URLSearchParams(window.location.search).get('docker') === 'true';
            if (!isDocker) {
              if (distance > GAP_THRESHOLD) {
                console.log(`Large gap detected (${(distance/1000).toFixed(1)}km), resetting trail`);
              }
              if (timeJump > TIME_JUMP_THRESHOLD) {
                console.log(`Time jump detected (${timeJump.toFixed(1)}s), resetting trail`);
              }
            }
            trailPositionsRef.current = [];
          }
        }

        try {
          trailPositionsRef.current.push(currentPosition.clone());
        } catch (e) {
          console.warn('Failed to clone currentPosition for trail, skipping point:', e);
        }

        if (trailPositionsRef.current.length > MAX_TRAIL_POINTS) {
          trailPositionsRef.current.shift();
        }

        lastAddedTimeRef.current = Cesium.JulianDate.clone(currentTime);
      } catch (err) {
        console.error('Error in preRender handler:', err);
      }
    };

    const postRenderListener = () => {
      try {
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

        // Stop controlling camera during ending animation
        if (isEndingAnimationRef.current) return;

        if (!hikerEntity || !hikerEntity.position) return;
        const currentTime = viewer.clock.currentTime;

        // Validate current time is within route bounds (but not during ending sequence)
        if (Cesium.JulianDate.compare(currentTime, startTime) < 0 ||
            Cesium.JulianDate.compare(currentTime, stopTime) >= 0) {
          // Time is out of bounds - clamp to valid range and STOP
          if (Cesium.JulianDate.compare(currentTime, startTime) < 0) {
            viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
          } else {
            // Route has ended naturally - start outro
            viewer.clock.currentTime = Cesium.JulianDate.clone(stopTime);
            viewer.clock.shouldAnimate = false;
            viewer.clock.multiplier = 0;
            console.log('✅ Route ended - starting outro');

            // Get final position and start vertical outro
            const finalPosition = hikerEntity.position!.getValue(stopTime);
            if (finalPosition && !isEndingAnimationRef.current) {
              isEndingAnimationRef.current = true;

              // Hide trail during outro to prevent artifacts
              if (entitiesRef.current.trail) {
                entitiesRef.current.trail.show = false;
              }

              let outroProgress = 0;
              const outroInterval = setInterval(() => {
                if (!viewer || viewer.isDestroyed() || outroProgress >= 1) {
                  clearInterval(outroInterval);
                  if (outroProgress >= 1) {
                    console.log('🎬 Outro complete');
                    (window as any).CESIUM_ANIMATION_COMPLETE = true;
                    console.log('✅ CESIUM_ANIMATION_COMPLETE flag set');

                    // Final status display
                    displayStatusBar();
                  }
                  return;
                }

                outroProgress += 0.02; // 5 seconds
                const eased = 1 - Math.pow(1 - outroProgress, 3); // Cubic ease-out

                // Go from -45° to -89° (vertical)
                const tilt = -45 + (-44 * eased);
                const distance = 1500 * (1 + eased);

                const lookAtZ = distance * Math.sin(Cesium.Math.toRadians(Math.abs(tilt)));
                viewer.camera.lookAt(finalPosition, new Cesium.Cartesian3(0, 0, lookAtZ));
              }, 100);
            }
          }
          return;
        }

        const position = hikerEntity.position.getValue(currentTime);
        if (!position || !position.x || !Cesium.Cartesian3.equals(position, position)) {
          console.warn('Invalid hiker position at time:', currentTime);
          return;
        }

        const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);

        // Use constant camera position (no dynamic altitude adjustment)
        const cameraOffsetLocal = new Cesium.Cartesian3(-CAMERA_BASE_BACK, 0, CAMERA_BASE_HEIGHT);
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
              // End: looking forward/behind (-1500, 0, 1200)
              const lookAtOffsetX = -1500 * tilt;
              const lookAtOffsetY = panOffset; // Side-to-side panning
              const lookAtOffsetZ = 1200;

              // Apply heading rotation to lookAt offset
              const headingRadians = Cesium.Math.toRadians(currentHeading);
              const rotatedX = lookAtOffsetX * Math.cos(headingRadians) - lookAtOffsetY * Math.sin(headingRadians);
              const rotatedY = lookAtOffsetX * Math.sin(headingRadians) + lookAtOffsetY * Math.cos(headingRadians);

              const lookAtOffset = new Cesium.Cartesian3(rotatedX, rotatedY, lookAtOffsetZ);
              viewer.camera.lookAt(position, lookAtOffset);
            } else {
              // Normal follow camera with continuous slow azimuth rotation
              const baseHeading = 25; // Base heading in degrees
              const continuousRotation = continuousAzimuthRef.current; // Slow continuous rotation
              const totalHeading = baseHeading + continuousRotation;

              const headingRadians = Cesium.Math.toRadians(totalHeading);
              const baseOffsetX = -1500;
              const baseOffsetY = 0;
              const rotatedX = baseOffsetX * Math.cos(headingRadians) - baseOffsetY * Math.sin(headingRadians);
              const rotatedY = baseOffsetX * Math.sin(headingRadians) + baseOffsetY * Math.cos(headingRadians);

              const lookAtOffset = new Cesium.Cartesian3(rotatedX, rotatedY, 1200);
              viewer.camera.lookAt(position, lookAtOffset);
            }
          }
        } catch (e) {
          console.warn('Camera update failed:', e);
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

    // Start with static camera at working position (looking straight down)
    viewer.clock.shouldAnimate = false;
    viewer.clock.multiplier = 0; // No animation yet

    const startingPosition = hikerEntity.position?.getValue(startTime);

    if (startingPosition && fullRoutePositions.length > 1) {
      console.log('Camera at working start position, waiting for globe to settle...');

      // Wait 1 second at starting position for globe to settle and mark ready
      setTimeout(() => {
        console.log('Globe settled, marking ready for recording and starting transition');
        (window as any).CESIUM_ANIMATION_READY = true;

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

        // Start route movement immediately with very slow speed
        viewer.clock.shouldAnimate = true;
        viewer.clock.multiplier = animationSpeed * 0.1; // Start at 10% speed

          // Phase 1: Simultaneous azimuth, tilt, and panning with route speed increase (5 seconds)
          let cameraProgress = 0;
          const cameraInterval = setInterval(() => {
            if (!viewer || viewer.isDestroyed() || !viewer.clock) {
              clearInterval(cameraInterval);
              return;
            }

            cameraProgress += 0.02; // 50 steps at 100ms = 5 seconds

            // Add subtle side-to-side panning during opening (sine wave: -200 to +200)
            cameraPanOffsetRef.current = Math.sin(cameraProgress * Math.PI * 2) * 200;

            // Gradually increase route speed during camera animation
            const speedEased = cameraProgress * cameraProgress; // Quadratic ease in
            const currentSpeed = animationSpeed * (0.1 + 0.4 * speedEased); // From 10% to 50% speed
            if (isFinite(currentSpeed) && currentSpeed >= 0) {
              viewer.clock.multiplier = currentSpeed;
            }
          if (cameraProgress >= 1) {
            cameraAzimuthProgressRef.current = 1;
            cameraTiltProgressRef.current = 1;
            clearInterval(cameraInterval);
            console.log('Camera animation complete, route at 50% speed, starting final speed increase');

                  // Phase 2: Continue route speed increase to full speed (2 seconds)
                  let speedProgress = 0;
                  const speedInterval = setInterval(() => {
                    if (!viewer || viewer.isDestroyed() || !viewer.clock) {
                      clearInterval(speedInterval);
                      return;
                    }

                    speedProgress += 0.05; // 20 steps at 100ms = 2 seconds
                    if (speedProgress >= 1) {
                      viewer.clock.multiplier = animationSpeed;
                      isInitialAnimationRef.current = false; // Initial animation complete
                      clearInterval(speedInterval);
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
                      // Continue easing speed from 50% to 100%
                      const speedEased = speedProgress * speedProgress; // Quadratic ease in
                      const currentSpeed = animationSpeed * (0.5 + 0.5 * speedEased); // From 50% to 100% speed
                      if (isFinite(currentSpeed) && currentSpeed >= 0) {
                        viewer.clock.multiplier = currentSpeed;
                      }
                    }
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
      }, 3000); // 3 seconds for globe and terrain to fully settle
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

    // Start animation immediately - postRenderListener will position camera correctly
    // It will use cameraTiltProgressRef (starting at 0) to look straight down
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