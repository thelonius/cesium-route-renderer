import * as Cesium from 'cesium';
import { useEffect } from 'react';

export interface CesiumCameraProps {
  viewer: Cesium.Viewer | null;
  targetEntity: Cesium.Entity | null;
  enableCollisionDetection?: boolean;
  smoothFactor?: number;
  hikerEntity: Cesium.Entity | null;
  isIntroComplete: boolean;
}

export default function useCesiumCamera({
  viewer,
  targetEntity,
  enableCollisionDetection = false,
  smoothFactor = 0.9,
  hikerEntity,
  isIntroComplete
}: CesiumCameraProps) {
  useEffect(() => {
    if (!viewer || !hikerEntity) return;

    viewer.scene.screenSpaceCameraController.enableCollisionDetection = enableCollisionDetection;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = smoothFactor;
    viewer.scene.screenSpaceCameraController.inertiaSpin = smoothFactor;
    viewer.scene.screenSpaceCameraController.inertiaZoom = smoothFactor - 0.1;

    if (isIntroComplete && targetEntity) {
      viewer.trackedEntity = targetEntity;
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.trackedEntity = undefined;
      }
    };
  }, [viewer, targetEntity, enableCollisionDetection, smoothFactor, hikerEntity, isIntroComplete]);
}