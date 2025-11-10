import * as Cesium from 'cesium';
import { useEffect, RefObject } from 'react';

export default function useViewerInit(
  ref: RefObject<HTMLDivElement>,
  viewerRef: RefObject<Cesium.Viewer>
) {
  useEffect(() => {
    if (!ref.current) {
      console.error('Cesium container ref is null');
      return;
    }

    (window as any).CESIUM_BASE_URL = '/cesium/';
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjN2Q4M2I1OS1kMDMyLTQ0OTMtOTgzOS1iMWQ5Njg3ZmZiMjgiLCJpZCI6MzUwMDA0LCJpYXQiOjE3NjAzNTM5MzB9.s4oI9AA2RPL7b8WqZKnjrWGONZaSVYjXR-P5iavOLlo';

    const isDocker = navigator.userAgent.includes('HeadlessChrome');
    const viewer = new Cesium.Viewer(ref.current, {
      timeline: !isDocker,  // Hide timeline in Docker mode
      animation: !isDocker, // Hide animation widget in Docker mode
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      shouldAnimate: true,
      requestRenderMode: !isDocker,
      maximumRenderTimeChange: isDocker ? 0 : Infinity,
      scene3DOnly: isDocker  // Disable 2D/Columbus modes in Docker for better performance
    });

    // Performance optimizations for Docker mode
    if (isDocker) {
      // Disable FXAA for better performance
      if (viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = false;
      }

      // Disable visual effects to improve rendering performance
      viewer.scene.fog.enabled = false;
      viewer.scene.skyAtmosphere.show = false;
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;
      viewer.shadows = false;
      viewer.terrainShadows = Cesium.ShadowMode.DISABLED;

      // Force continuous rendering
      viewer.scene.requestRenderMode = false;
      viewer.scene.maximumRenderTimeChange = 0;

      // Hide Cesium credits/attribution
      const creditContainer = viewer.bottomContainer as HTMLElement;
      if (creditContainer) {
        creditContainer.style.display = 'none';
      }
    }

    if (viewerRef) {
      viewerRef.current = viewer;
    }

    // Load terrain
    (async () => {
      try {
        const terrainProvider = await Cesium.createWorldTerrainAsync({
          requestWaterMask: false,
          requestVertexNormals: false
        });
        viewer.terrainProvider = terrainProvider;
      } catch (error) {
        console.warn('Could not load terrain:', error);
      }
    })();

    // Load imagery
    (async () => {
      try {
        viewer.imageryLayers.removeAll();
        const ionImagery = await Cesium.IonImageryProvider.fromAssetId(2, {});
        viewer.imageryLayers.addImageryProvider(ionImagery);
      } catch (error) {
        console.warn('Could not load Cesium imagery, falling back to OpenStreetMap:', error);
        try {
          const osm = new Cesium.OpenStreetMapImageryProvider({
            url: 'https://a.tile.openstreetmap.org/'
          });
          viewer.imageryLayers.addImageryProvider(osm);
        } catch (osmError) {
          console.error('Could not load any imagery provider:', osmError);
        }
      }
    })();

    return () => {
      if (viewer) {
        viewer.destroy();
      }
    };
  }, [ref]);
}