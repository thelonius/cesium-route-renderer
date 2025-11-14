import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { TrackPoint } from '../types';

interface UseCesiumAnimationProps {
  viewer: Cesium.Viewer | null;
  trackPoints: TrackPoint[];
  startTime: Cesium.JulianDate | undefined;
  stopTime: Cesium.JulianDate | undefined;
  animationSpeed?: number; // Optional animation speed multiplier (default 50x)
}

const CAMERA_BASE_BACK = 6240; // Increased by 2.6x (was 2400)
const CAMERA_BASE_HEIGHT = 3120; // Increased by 2.6x (was 1200)
const CAMERA_SMOOTH_ALPHA = 0.15;
const ADD_INTERVAL_SECONDS = 1.0; // Increased from 0.5 for better performance
const MAX_TRAIL_POINTS = 200; // Reduced from 500 for better performance

export default function useCesiumAnimation({
  viewer,
  trackPoints,
  startTime,
  stopTime,
  animationSpeed = 50 // Default to 50x for better FPS (reduced from 100x)
}: UseCesiumAnimationProps) {

  const trailPositionsRef = useRef<Cesium.Cartesian3[]>([]);
  const lastAddedTimeRef = useRef<Cesium.JulianDate | null>(null);
  const smoothedBackRef = useRef(CAMERA_BASE_BACK);
  const smoothedHeightRef = useRef(CAMERA_BASE_HEIGHT);
  const cameraAzimuthProgressRef = useRef(0); // 0 = no rotation, 1 = full azimuth (for opening)
  const cameraTiltProgressRef = useRef(0); // 0 = looking down, 1 = fully tilted
  const isInitialAnimationRef = useRef(true); // Track if we're still in opening animation
  const isEndingAnimationRef = useRef(false); // Track if we're in ending animation
  const isOutroAnimationRef = useRef(false); // Track if we're in outro animation
  const continuousAzimuthRef = useRef(0); // Continuous slow rotation during main route
  const cameraPanOffsetRef = useRef(0); // Side-to-side panning offset
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
    isOutroAnimationRef.current = false;
    continuousAzimuthRef.current = 0;
    cameraPanOffsetRef.current = 0;
    trailPositionsRef.current = [];
    console.log('Animation state reset for new route');

    const initializeAnimation = () => {
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

    // Create dynamic trail
    const trailEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailPositionsRef.current, false),
        width: 5,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW),
        depthFailMaterial: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW),
        clampToGround: true,
        show: true
      }
    });
    entitiesRef.current.trail = trailEntity;

    // Setup camera tracking
    const preRenderListener = () => {
      try {
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
        // Stop controlling camera during outro animation
        if (isOutroAnimationRef.current) return;
        
        if (!hikerEntity || !hikerEntity.position) return;
        const currentTime = viewer.clock.currentTime;
        
        // Validate current time is within route bounds
        if (Cesium.JulianDate.compare(currentTime, startTime) < 0 || 
            Cesium.JulianDate.compare(currentTime, stopTime) >= 0) {
          // Time is out of bounds - clamp to valid range and STOP
          if (Cesium.JulianDate.compare(currentTime, startTime) < 0) {
            viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
          } else {
            // Route has ended - stop everything immediately
            viewer.clock.currentTime = Cesium.JulianDate.clone(stopTime);
            viewer.clock.shouldAnimate = false;
            viewer.clock.multiplier = 0;
            console.log('Route ended - animation stopped at stopTime');
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
        viewer.clock.shouldAnimate = true; // Start route movement
          
          // Phase 1: Simultaneous azimuth, tilt, and panning (5 seconds)
          let cameraProgress = 0;
          const cameraInterval = setInterval(() => {
            cameraProgress += 0.02; // 50 steps at 100ms = 5 seconds
            
            // Add subtle side-to-side panning during opening (sine wave: -200 to +200)
            cameraPanOffsetRef.current = Math.sin(cameraProgress * Math.PI * 2) * 200;
          if (cameraProgress >= 1) {
            cameraAzimuthProgressRef.current = 1;
            cameraTiltProgressRef.current = 1;
            clearInterval(cameraInterval);
            console.log('Camera animation complete, starting route movement ease-in');
                  
                  // Phase 3: Ease in route movement speed (3 seconds)
                  let speedProgress = 0;
                  const speedInterval = setInterval(() => {
                    speedProgress += 0.033; // 30 steps at 100ms = 3 seconds
                    if (speedProgress >= 1) {
                      viewer.clock.multiplier = animationSpeed;
                      isInitialAnimationRef.current = false; // Initial animation complete
                      clearInterval(speedInterval);
                      console.log(`Route animation at full speed: ${animationSpeed}x`);
                      
                      // Start continuous slow azimuth rotation during main route
                      const azimuthRotationInterval = setInterval(() => {
                        if (!isEndingAnimationRef.current && viewer.clock.shouldAnimate) {
                          // Rotate slowly: 360° over ~2 minutes = 0.05°/frame at 10fps
                          continuousAzimuthRef.current += 0.05;
                          if (continuousAzimuthRef.current >= 360) {
                            continuousAzimuthRef.current = 0;
                          }
                        } else {
                          clearInterval(azimuthRotationInterval);
                        }
                      }, 100);
                      
                      // Monitor for route completion
                      const checkCompletion = setInterval(() => {
                        // Stop checking if animation is already stopped
                        if (!viewer.clock.shouldAnimate) {
                          clearInterval(checkCompletion);
                          return;
                        }
                        
                        const currentTime = viewer.clock.currentTime;
                        const timeRemaining = Cesium.JulianDate.secondsDifference(stopTime, currentTime);
                        
                        // Check if we've reached or passed the end
                        if (timeRemaining <= 0 || Cesium.JulianDate.compare(currentTime, stopTime) >= 0) {
                          console.log('Route ended - stopping animation immediately');
                          viewer.clock.currentTime = Cesium.JulianDate.clone(stopTime);
                          viewer.clock.multiplier = 0;
                          viewer.clock.shouldAnimate = false;
                          clearInterval(checkCompletion);
                          return;
                        }
                        
                        // Start ending sequence 15 seconds before finish to give time to brake
                        if (timeRemaining <= 15 && !isEndingAnimationRef.current) {
                          console.log('Route ending, starting calm outro sequence');
                          clearInterval(checkCompletion);
                          isEndingAnimationRef.current = true; // Enable ending animation mode
                          
                          // Capture current state before entering ending mode
                          const currentAzimuth = continuousAzimuthRef.current;
                          console.log(`Ending state: azimuth=${currentAzimuth.toFixed(2)}°, panning=${cameraPanOffsetRef.current.toFixed(2)}px`);
                          
                          // Ease speed back down over 15 seconds
                          const startSpeed = viewer.clock.multiplier;
                          const endingStartTime = Cesium.JulianDate.now();
                          
                          const slowdownInterval = setInterval(() => {
                            // Check if route has ended first
                            const now = viewer.clock.currentTime;
                            const remaining = Cesium.JulianDate.secondsDifference(stopTime, now);
                            
                            if (remaining <= 0) {
                              // Route finished - start outro sequence
                              viewer.clock.currentTime = Cesium.JulianDate.clone(stopTime);
                              viewer.clock.multiplier = 0;
                              viewer.clock.shouldAnimate = false;
                              cameraPanOffsetRef.current = 0;
                              continuousAzimuthRef.current = currentAzimuth; // Freeze azimuth
                              isOutroAnimationRef.current = true; // Enable outro mode - postRenderListener will stop
                              clearInterval(slowdownInterval);
                              console.log('🎬 Route ended - starting outro sequence');
                              
                              // Start outro: smooth camera pullback over 5 seconds
                              const finalPosition = hikerEntity.position!.getValue(stopTime);
                              if (finalPosition) {
                                viewer.camera.cancelFlight();
                                
                                // Calculate a nice overview position
                                const transform = Cesium.Transforms.eastNorthUpToFixedFrame(finalPosition);
                                const outroStartOffset = new Cesium.Cartesian3(-CAMERA_BASE_BACK, 0, CAMERA_BASE_HEIGHT);
                                const outroEndOffset = new Cesium.Cartesian3(-CAMERA_BASE_BACK * 3, 0, CAMERA_BASE_HEIGHT * 3);
                                
                                let outroProgress = 0;
                                const outroStartTilt = -45; // Current tilt angle in degrees
                                const outroEndTilt = -70; // More vertical at the end
                                
                                const outroInterval = setInterval(() => {
                                  outroProgress += 0.02; // 50 steps = 5 seconds
                                  
                                  if (!viewer || viewer.isDestroyed() || outroProgress >= 1) {
                                    clearInterval(outroInterval);
                                    if (outroProgress >= 1) {
                                      console.log('🎬 Outro complete');
                                      // Signal that animation is fully complete (for recording scripts)
                                      (window as any).CESIUM_ANIMATION_COMPLETE = true;
                                      console.log('✅ CESIUM_ANIMATION_COMPLETE flag set');
                                    }
                                    return;
                                  }
                                  
                                  console.log(`Outro progress: ${(outroProgress * 100).toFixed(0)}%`);
                                  
                                  // Quartic ease out for smooth deceleration
                                  const eased = 1 - Math.pow(1 - outroProgress, 4);
                                  
                                  // Add sine wave panning during outro
                                  const panningX = Math.sin(outroProgress * Math.PI * 2) * 300 * (1 - eased); // Fade out panning
                                  
                                  // Interpolate tilt angle - go more vertical
                                  const currentTilt = Cesium.Math.lerp(outroStartTilt, outroEndTilt, eased);
                                  
                                  // Gradually increase camera distance
                                  const finalHeading = 25 + currentAzimuth;
                                  const baseDistance = 1500;
                                  const currentDistance = baseDistance * (1 + eased * 2.5); // Pull back further
                                  
                                  // Calculate lookAt offset with tilt and panning
                                  const lookAtOffsetX = currentDistance * Math.cos(Cesium.Math.toRadians(currentTilt));
                                  const lookAtOffsetY = panningX;
                                  const lookAtOffsetZ = currentDistance * Math.sin(Cesium.Math.toRadians(Math.abs(currentTilt)));
                                  
                                  // Apply heading rotation
                                  const headingRadians = Cesium.Math.toRadians(finalHeading);
                                  const rotatedX = lookAtOffsetX * Math.cos(headingRadians) - lookAtOffsetY * Math.sin(headingRadians);
                                  const rotatedY = lookAtOffsetX * Math.sin(headingRadians) + lookAtOffsetY * Math.cos(headingRadians);
                                  
                                  viewer.camera.lookAt(finalPosition, new Cesium.Cartesian3(rotatedX, rotatedY, lookAtOffsetZ));
                                }, 100);
                              }
                              
                              return;
                            }
                            
                            // Calculate progress based on how close we are to the end
                            // Use remaining time instead of elapsed time to ensure we stop in time
                            const slowProgress = Math.min((15 - remaining) / 15, 1);
                            
                            // Use more aggressive easing - quintic (x^5) for faster deceleration
                            const eased = 1 - Math.pow(1 - slowProgress, 5);
                            
                            // Gradually reduce panning to zero (smooth fade out)
                            const panFade = Math.max(0, 1 - slowProgress);
                            cameraPanOffsetRef.current = Math.sin(slowProgress * Math.PI * 2) * -200 * panFade;
                            
                            // Gradually slow down azimuth rotation
                            const azimuthFade = Math.max(0, 1 - slowProgress);
                            continuousAzimuthRef.current = currentAzimuth + (slowProgress * 10 * azimuthFade);
                            
                            // Apply speed reduction - more aggressive near the end
                            const newMultiplier = startSpeed * (1 - eased);
                            if (isFinite(newMultiplier) && newMultiplier >= 0) {
                              // Ensure we slow down significantly: minimum speed drops as we approach end
                              const minSpeed = Math.max(0.05, (1 - slowProgress) * 0.5);
                              viewer.clock.multiplier = Math.max(minSpeed, newMultiplier);
                            }
                            
                            // Extra safety: if we're very close to the end (last 2 seconds), slow to crawl
                            if (remaining <= 2) {
                              viewer.clock.multiplier = Math.min(viewer.clock.multiplier, 0.1);
                            }
                            
                            // Stop if we've completed the slowdown
                            if (slowProgress >= 1 || remaining <= 0.5) {
                              clearInterval(slowdownInterval);
                            }
                          }, 100);
                        }
                      }, 100);
                    } else {
                      // Cubic ease in for speed
                      const speedEased = speedProgress * speedProgress * speedProgress;
                      const newMultiplier = animationSpeed * speedEased;
                      if (isFinite(newMultiplier) && newMultiplier >= 0) {
                        viewer.clock.multiplier = newMultiplier;
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
      }, 1000); // 1 second for globe to settle
    } else {
      // Fallback
      setTimeout(() => {
        viewer.clock.shouldAnimate = true;
        viewer.clock.multiplier = animationSpeed;
        (window as any).CESIUM_ANIMATION_READY = true;
      }, 2000);
    }

    console.log('Animation setup complete, starting camera tilt animation...');
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