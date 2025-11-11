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
  const [entity, setEntity] = useState<Cesium.Entity | null>(null);

  useEffect(() => {
    if (!viewer || !trackPoints.length || !startTime || !stopTime) return;

    // Initialize lastAddedTimeRef
    lastAddedTimeRef.current = Cesium.JulianDate.clone(startTime);

    // Configure the clock for animation
    viewer.clock.startTime = Cesium.JulianDate.clone(startTime);
    viewer.clock.stopTime = Cesium.JulianDate.clone(stopTime);
    viewer.clock.currentTime = Cesium.JulianDate.clone(startTime);
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = animationSpeed; // Use dynamic animation speed
    viewer.clock.shouldAnimate = true;

    console.log(`Animation speed set to: ${animationSpeed}x`);

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
          const TIME_JUMP_THRESHOLD = 5; // 5 seconds

          if (distance > GAP_THRESHOLD || timeJump > TIME_JUMP_THRESHOLD) {
            if (distance > GAP_THRESHOLD) {
              console.log(`Large gap detected (${(distance/1000).toFixed(1)}km), resetting trail`);
            }
            if (timeJump > TIME_JUMP_THRESHOLD) {
              console.log(`Time jump detected (${timeJump.toFixed(1)}s), resetting trail`);
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
        if (!hikerEntity || !hikerEntity.position) return;
        const currentTime = viewer.clock.currentTime;
        const position = hikerEntity.position.getValue(currentTime);
        if (!position || !position.x) return;

        const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);

        let terrainHeight = 0;
        try {
          const cart = Cesium.Cartographic.fromCartesian(position);
          const h = viewer.scene.globe.getHeight(cart);
          if (typeof h === 'number' && Number.isFinite(h)) terrainHeight = h;
        } catch (e) {
          // ignore
        }

        const dynamicHeight = Math.max(CAMERA_BASE_HEIGHT, terrainHeight * 0.2 + 2080); // 2.6x of 800
        const dynamicBack = Math.max(3120, Math.min(20800, CAMERA_BASE_BACK + terrainHeight * 0.05)); // Min/max scaled by 2.6x

        smoothedBackRef.current = smoothedBackRef.current * (1 - CAMERA_SMOOTH_ALPHA) + dynamicBack * CAMERA_SMOOTH_ALPHA;
        smoothedHeightRef.current = smoothedHeightRef.current * (1 - CAMERA_SMOOTH_ALPHA) + dynamicHeight * CAMERA_SMOOTH_ALPHA;

        const cameraOffsetLocal = new Cesium.Cartesian3(-smoothedBackRef.current, 0, smoothedHeightRef.current);
        const cameraPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3());

        try {
          viewer.camera.position = cameraPosition;
          if (position) {
            // Look at a point ahead and below the target for better terrain visibility
            // Offset (x, y, z) where negative x looks behind the target direction
            // This creates a tilted view looking forward and down at the terrain
            const lookAtOffset = new Cesium.Cartesian3(
              -1500, // Look behind the hiker
              0,     // No side offset
              1200   // Look above ground level
            );
            viewer.camera.lookAt(position, lookAtOffset);
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

    // Enable smooth camera controls
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.9;
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.9;
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.8;

    // Pause clock initially - will start after opening animation
    viewer.clock.shouldAnimate = false;

    // Position camera at starting position with opening animation
    const startingPosition = hikerEntity.position?.getValue(startTime);
    if (startingPosition && fullRoutePositions.length > 1) {
      // Calculate bounding sphere of the route
      const boundingSphere = Cesium.BoundingSphere.fromPoints(fullRoutePositions);
      const radius = boundingSphere.radius;

      // Set initial altitude based on route size
      const baseAltitude = Math.max(radius * 2.5, 2000); // Minimum 2km altitude
      const cappedAltitude = Math.min(baseAltitude, 15000); // Maximum 15km altitude

      const startingCartographic = Cesium.Cartographic.fromCartesian(startingPosition);
      
      // Set overview position immediately (no animation)
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
          startingCartographic.longitude,
          startingCartographic.latitude,
          cappedAltitude
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0
        }
      });

      // Wait for terrain to settle before starting opening animation
      console.log('Waiting for terrain to settle...');
      setTimeout(() => {
        console.log('Terrain settled, starting subtle opening animation...');
        
        // Calculate follow-cam position
        const transform = Cesium.Transforms.eastNorthUpToFixedFrame(startingPosition);
        const cameraOffsetLocal = new Cesium.Cartesian3(-CAMERA_BASE_BACK, 0, CAMERA_BASE_HEIGHT);
        const followPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3());
        
        // Start from slightly higher and closer for subtle motion
        const startingAltitude = cappedAltitude * 0.7; // 70% of overview altitude
        const startPosition = Cesium.Cartesian3.fromRadians(
          startingCartographic.longitude,
          startingCartographic.latitude,
          startingAltitude
        );
        
        // Set the subtle starting position
        viewer.camera.setView({
          destination: startPosition,
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-40),
            roll: 0
          }
        });
        
        // Gentle fly-in with easing
        viewer.camera.flyTo({
          destination: followPosition,
          orientation: {
            direction: Cesium.Cartesian3.subtract(startingPosition, followPosition, new Cesium.Cartesian3()),
            up: Cesium.Cartesian3.normalize(
              Cesium.Matrix4.multiplyByPointAsVector(transform, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            )
          },
          duration: 4.0, // Slower, gentler 4 second animation
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, // Smooth easing
          complete: () => {
            console.log('Opening animation complete, starting route animation');
            viewer.clock.shouldAnimate = true;
            (window as any).CESIUM_ANIMATION_READY = true;
          }
        });
      }, 2000); // Wait 2 seconds for terrain tiles to load
    } else {
      // Fallback if no valid position
      setTimeout(() => {
        viewer.clock.shouldAnimate = true;
        (window as any).CESIUM_ANIMATION_READY = true;
      }, 2000);
    }

    console.log('Animation setup complete, waiting for terrain and opening animation...');

    return () => {
      viewer.scene.preRender.removeEventListener(preRenderListener);
      viewer.scene.postRender.removeEventListener(postRenderListener);
      if (hikerEntity) {
        viewer.entities.remove(hikerEntity);
      }
      if (trailEntity) {
        viewer.entities.remove(trailEntity);
      }
    };
  }, [viewer, trackPoints, startTime, stopTime]);

  return entity;
}