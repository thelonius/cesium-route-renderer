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
      timeline: false,  // Disable timeline
      animation: false, // Disable animation widget
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      shouldAnimate: true,
      requestRenderMode: !isDocker,
      maximumRenderTimeChange: isDocker ? 0 : Infinity,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true // Required for canvas frame capture
        }
      }
    });

    // Disable FXAA for better performance in headless mode
    if (isDocker && viewer.scene.postProcessStages.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = false;
    }

    // Hide Cesium credits/attribution in Docker mode
    if (isDocker) {
      const creditContainer = viewer.bottomContainer as HTMLElement;
      if (creditContainer) {
        creditContainer.style.display = 'none';
      }
    }

    // Force continuous rendering in Docker
    if (isDocker) {
      viewer.scene.requestRenderMode = false;
      viewer.scene.maximumRenderTimeChange = 0;

      // Performance optimizations for Docker mode
      viewer.scene.globe.enableLighting = false; // Disable lighting calculations
      viewer.scene.fog.enabled = false; // Disable fog
      viewer.scene.sun.show = false; // Hide sun
      viewer.scene.moon.show = false; // Hide moon

      // Keep skybox and atmosphere for better visuals (they're relatively cheap)
      // viewer.scene.skyAtmosphere.show = false;
      // viewer.scene.skyBox.show = false;
      // viewer.scene.backgroundColor = Cesium.Color.BLACK;

      // Reduce terrain detail significantly for faster rendering on CPU
      viewer.scene.globe.maximumScreenSpaceError = 8; // Higher = lower quality = faster (default 2, set to 8 for better quality)
      viewer.scene.globe.tileCacheSize = 25; // Smaller cache = less memory, faster (reduced from 50)
    }

    if (viewerRef) {
      (viewerRef as any).current = viewer;
    }

    // Expose viewer globally for debug tools and recorder
    try {
      (window as any).__CESIUM_VIEWER = viewer;
      // Expose Cesium library globally for recorder's manual time stepping
      (window as any).__CESIUM = Cesium;
    } catch (e) {
      // ignore
    }

    // Verify preserveDrawingBuffer is set correctly (especially important for Docker)
    if (isDocker) {
      const canvas = viewer.scene.canvas;
      const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
      if (gl && 'getContextAttributes' in gl) {
        const attrs = gl.getContextAttributes();
        const preserveDrawingBuffer = attrs?.preserveDrawingBuffer;
        console.log('🎨 Canvas preserveDrawingBuffer:', preserveDrawingBuffer);
        if (!preserveDrawingBuffer) {
          console.warn('⚠️ preserveDrawingBuffer is NOT enabled! Canvas capture will fail.');
        }
      }
    }

    // Load terrain with lower detail in Docker mode
    (async () => {
      try {
        const terrainProvider = await Cesium.createWorldTerrainAsync({
          requestWaterMask: false,
          requestVertexNormals: false
        });
        viewer.terrainProvider = terrainProvider;

        // Further optimize terrain in Docker mode
        if (isDocker) {
          viewer.scene.globe.preloadAncestors = false; // Don't preload lower-res tiles
          viewer.scene.globe.preloadSiblings = false; // Don't preload adjacent tiles
        }
      } catch (error) {
        console.warn('Could not load terrain:', error);
      }
    })();

    // Load imagery - prioritize ArcGIS satellite imagery (no Ion required), then fallback chain
    (async () => {
      try {
        viewer.imageryLayers.removeAll();

        // Try ArcGIS World Imagery first - free, high quality satellite imagery, no Ion required
        console.log('🔄 Attempting to load ArcGIS World Imagery...');
        const arcgisImagery = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        );
        viewer.imageryLayers.addImageryProvider(arcgisImagery);
        console.log('✅ Successfully loaded ArcGIS World Imagery (satellite)');

      } catch (arcgisError) {
        console.warn('❌ ArcGIS failed, trying Bing Maps via Ion...', arcgisError instanceof Error ? arcgisError.message : String(arcgisError));

        try {
          // Try Cesium Ion Bing Maps as fallback
          const ionImagery = await Cesium.IonImageryProvider.fromAssetId(2, {});
          viewer.imageryLayers.addImageryProvider(ionImagery);
          console.log('✅ Successfully loaded Bing Maps imagery via Ion');

        } catch (error) {
          console.warn('❌ Bing Maps failed, trying Sentinel-2...', error instanceof Error ? error.message : String(error));

          try {
            // Try Sentinel-2 as high-quality alternative
            const sentinelImagery = await Cesium.IonImageryProvider.fromAssetId(3954, {});
            viewer.imageryLayers.addImageryProvider(sentinelImagery);
            console.log('✅ Loaded Sentinel-2 imagery (high quality)');

          } catch (sentinelError) {
            console.warn('❌ Sentinel-2 failed, falling back to OpenStreetMap...', sentinelError instanceof Error ? sentinelError.message : String(sentinelError));

            try {
              // Final fallback to OpenStreetMap
              const osm = new Cesium.OpenStreetMapImageryProvider({
                url: 'https://a.tile.openstreetmap.org/'
              });
              viewer.imageryLayers.addImageryProvider(osm);
              console.log('✅ Loaded OpenStreetMap imagery (reliable fallback)');

            } catch (osmError) {
              console.error('❌ All imagery providers failed:', osmError instanceof Error ? osmError.message : String(osmError));
            }
          }
        }
      }
    })();

    return () => {
      if (viewer) {
        viewer.destroy();
        try { (window as any).__CESIUM_VIEWER = null; } catch (e) { }
      }
    };
  }, [ref]);
}