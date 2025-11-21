import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import {
  CesiumCameraService,
  CameraStrategy,
  RoutePatternType
} from '../services/cesiumCameraService';

export interface CesiumCameraProps {
  viewer: Cesium.Viewer | null;
  targetEntity: Cesium.Entity | null;
  enableCollisionDetection?: boolean;
  smoothFactor?: number;
  hikerEntity: Cesium.Entity | null;
  isIntroComplete: boolean;
  // New props for advanced camera service
  cameraStrategy?: CameraStrategy;
  routePattern?: RoutePatternType;
  positions?: Cesium.Cartesian3[];
  times?: Cesium.JulianDate[];
  enableAdvancedCamera?: boolean;
}

export default function useCesiumCamera({
  viewer,
  targetEntity,
  enableCollisionDetection = false,
  smoothFactor = 0.9,
  hikerEntity,
  isIntroComplete,
  cameraStrategy = 'follow',
  routePattern = 'unknown',
  positions = [],
  times = [],
  enableAdvancedCamera = false
}: CesiumCameraProps) {
  const cameraServiceRef = useRef<CesiumCameraService | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize camera service
  useEffect(() => {
    if (!viewer || !enableAdvancedCamera) {
      cameraServiceRef.current = null;
      setCameraReady(false);
      return;
    }

    console.log(`🎥 Initializing camera service with strategy: ${cameraStrategy}`);
    cameraServiceRef.current = new CesiumCameraService(viewer, cameraStrategy);

    // Set route pattern if provided
    if (routePattern && routePattern !== 'unknown') {
      cameraServiceRef.current.setRoutePattern(routePattern);
      console.log(`📍 Camera pattern set to: ${routePattern}`);
    }

    setCameraReady(true);

    return () => {
      cameraServiceRef.current = null;
      setCameraReady(false);
    };
  }, [viewer, cameraStrategy, routePattern, enableAdvancedCamera]);

  // Generate keyframes when positions/times are available
  useEffect(() => {
    if (!cameraServiceRef.current || !positions.length || !times.length) return;
    if (positions.length !== times.length) {
      console.warn('Camera: positions and times length mismatch');
      return;
    }

    console.log(`🎬 Generating ${positions.length} camera keyframes...`);

    // Analyze route for segments
    const segments = cameraServiceRef.current.analyzeRoute(positions);
    console.log(`📊 Detected ${segments.length} route segments`);

    // Generate keyframes
    const keyframes = cameraServiceRef.current.generateKeyframes(positions, times, segments);
    console.log(`✅ Generated ${keyframes.length} camera keyframes`);
  }, [positions, times]);

  // Update camera during animation
  useEffect(() => {
    if (!viewer || !cameraServiceRef.current || !isIntroComplete || !enableAdvancedCamera) {
      return;
    }

    if (!cameraReady) {
      console.log('⏳ Waiting for camera service to be ready...');
      return;
    }

    console.log('🎥 Starting advanced camera updates');

    const updateCamera = () => {
      if (!viewer || !cameraServiceRef.current) return;

      const currentTime = viewer.clock.currentTime;
      const startTime = viewer.clock.startTime;

      // Calculate timestamp in seconds from start
      const timestamp = Cesium.JulianDate.secondsDifference(currentTime, startTime);

      // Apply camera at current timestamp
      cameraServiceRef.current.applyCameraAtTime(timestamp);

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(updateCamera);
    };

    // Start camera updates
    animationFrameRef.current = requestAnimationFrame(updateCamera);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [viewer, cameraReady, isIntroComplete, enableAdvancedCamera]);

  // Basic camera setup (original functionality)
  useEffect(() => {
    if (!viewer || !hikerEntity) return;

    viewer.scene.screenSpaceCameraController.enableCollisionDetection = enableCollisionDetection;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = smoothFactor;
    viewer.scene.screenSpaceCameraController.inertiaSpin = smoothFactor;
    viewer.scene.screenSpaceCameraController.inertiaZoom = smoothFactor - 0.1;

    // Use tracked entity for basic camera (when advanced camera is disabled)
    if (isIntroComplete && targetEntity && !enableAdvancedCamera) {
      viewer.trackedEntity = targetEntity;
      console.log('📹 Using tracked entity camera (basic mode)');
    } else if (enableAdvancedCamera) {
      // Disable tracked entity when using advanced camera
      viewer.trackedEntity = undefined;
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.trackedEntity = undefined;
      }
    };
  }, [viewer, targetEntity, enableCollisionDetection, smoothFactor, hikerEntity, isIntroComplete, enableAdvancedCamera]);

  // Expose camera service for external access
  return {
    cameraService: cameraServiceRef.current,
    cameraReady
  };
}
