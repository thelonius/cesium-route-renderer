import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { TrackPoint } from '../types';

interface UseCesiumAnimationProps {
  viewer: Cesium.Viewer | null;
  trackPoints: TrackPoint[];
  startTime: Cesium.JulianDate | undefined;
  stopTime: Cesium.JulianDate | undefined;
}

const CAMERA_BASE_BACK = 2400;
const CAMERA_BASE_HEIGHT = 1200;
const CAMERA_SMOOTH_ALPHA = 0.15;
const ADD_INTERVAL_SECONDS = 0.5;
const MAX_TRAIL_POINTS = 500;

export default function useCesiumAnimation({
  viewer,
  trackPoints,
  startTime,
  stopTime
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
    viewer.clock.multiplier = 50; // Adjust speed as needed
    viewer.clock.shouldAnimate = true;

    // Create position property for smooth animation
    const hikerPositions = new Cesium.SampledPositionProperty();
    trackPoints.forEach(point => {
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
        text: 'Mikael Norhairovich',
        font: '14pt sans-serif',
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });

    setEntity(hikerEntity);

    // Create full route polyline
    const fullRoutePositions = trackPoints
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

        const dynamicHeight = Math.max(CAMERA_BASE_HEIGHT, terrainHeight * 0.2 + 800);
        const dynamicBack = Math.max(1200, Math.min(8000, CAMERA_BASE_BACK + terrainHeight * 0.05));

        smoothedBackRef.current = smoothedBackRef.current * (1 - CAMERA_SMOOTH_ALPHA) + dynamicBack * CAMERA_SMOOTH_ALPHA;
        smoothedHeightRef.current = smoothedHeightRef.current * (1 - CAMERA_SMOOTH_ALPHA) + dynamicHeight * CAMERA_SMOOTH_ALPHA;

        const cameraOffsetLocal = new Cesium.Cartesian3(-smoothedBackRef.current, 0, smoothedHeightRef.current);
        const cameraPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3());

        try {
          viewer.camera.position = cameraPosition;
          if (position) {
            viewer.camera.lookAt(position, new Cesium.Cartesian3(0, 0, Math.max(800, dynamicHeight * 0.5)));
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

    // Position camera at starting position with appropriate zoom based on route extent
    const startingPosition = hikerEntity.position?.getValue(startTime);
    if (startingPosition && fullRoutePositions.length > 1) {
      // Calculate bounding sphere of the route
      const boundingSphere = Cesium.BoundingSphere.fromPoints(fullRoutePositions);
      const radius = boundingSphere.radius;

      // Set initial altitude based on route size
      // For small routes (< 1km radius), use closer view
      // For larger routes, scale appropriately
      const baseAltitude = Math.max(radius * 2.5, 2000); // Minimum 2km altitude
      const cappedAltitude = Math.min(baseAltitude, 15000); // Maximum 15km altitude

      const startingCartographic = Cesium.Cartographic.fromCartesian(startingPosition);
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
    }

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