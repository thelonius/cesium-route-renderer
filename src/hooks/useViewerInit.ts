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
      timeline: !isDocker,  // Enable timeline except in Docker
      animation: !isDocker, // Enable animation widget except in Docker
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      shouldAnimate: true,
      requestRenderMode: !isDocker,
      maximumRenderTimeChange: isDocker ? 0 : Infinity,
      shadows: true, // Enable shadows for realistic lighting
      terrainShadows: Cesium.ShadowMode.ENABLED, // Enable terrain shadows
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true, // Required for canvas frame capture
          alpha: false, // Better performance
          depth: true,
          stencil: false,
          antialias: true, // Enable antialiasing
          powerPreference: 'high-performance' // Request high-performance GPU
        }
      }
    });

    // Enable FXAA anti-aliasing for better quality
    if (isDocker && viewer.scene.postProcessStages.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = true;
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

      // Enable high-quality graphics for GPU server
      viewer.scene.globe.enableLighting = true; // Enable realistic lighting
      viewer.scene.fog.enabled = true; // Enable atmospheric fog
      viewer.scene.sun.show = true; // Show sun
      viewer.scene.moon.show = true; // Show moon
      viewer.scene.skyAtmosphere.show = true; // Show atmosphere
      viewer.scene.skyBox.show = true; // Show skybox

      // Maximum terrain detail for GPU rendering
      viewer.scene.globe.maximumScreenSpaceError = 1.5; // Lower = higher quality (default 2, 1.5 for better detail)
      viewer.scene.globe.tileCacheSize = 500; // Large cache for better performance with high detail
    }

    if (viewerRef) {
      viewerRef.current = viewer;
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

    // Load high-quality terrain
    (async () => {
      try {
        const terrainProvider = await Cesium.createWorldTerrainAsync({
          requestWaterMask: true, // Enable water effects
          requestVertexNormals: true // Enable realistic lighting on terrain
        });
        viewer.terrainProvider = terrainProvider;

        // Optimize terrain loading for GPU server
        if (isDocker) {
          viewer.scene.globe.preloadAncestors = true; // Preload lower-res tiles for smoother transitions
          viewer.scene.globe.preloadSiblings = true; // Preload adjacent tiles
        }
      } catch (error) {
        console.warn('Could not load terrain:', error);
      }
    })();

    // Load high-resolution imagery
    (async () => {
      try {
        viewer.imageryLayers.removeAll();
        // Use Sentinel-2 satellite imagery (Asset ID 3954) for highest quality
        const ionImagery = await Cesium.IonImageryProvider.fromAssetId(3954, {});
        const imageryLayer = viewer.imageryLayers.addImageryProvider(ionImagery);
        
        // Increase texture quality
        imageryLayer.brightness = 1.0;
        imageryLayer.contrast = 1.1; // Slightly enhanced contrast
        imageryLayer.saturation = 1.1; // Slightly enhanced saturation
        
        console.log('✅ Loaded high-resolution Sentinel-2 imagery');
      } catch (error) {
        console.warn('Could not load Sentinel-2 imagery, trying Bing Maps:', error);
        try {
          // Fallback to Bing Maps aerial with labels
          const bingImagery = await Cesium.IonImageryProvider.fromAssetId(2, {});
          viewer.imageryLayers.addImageryProvider(bingImagery);
          console.log('✅ Loaded Bing Maps imagery');
        } catch (bingError) {
          console.warn('Could not load Bing Maps, falling back to OpenStreetMap:', bingError);
          try {
            const osm = new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/'
            });
            viewer.imageryLayers.addImageryProvider(osm);
            console.log('✅ Loaded OpenStreetMap imagery');
          } catch (osmError) {
            console.error('Could not load any imagery provider:', osmError);
          }
        }
      }
    })();
    
    // Additional quality settings for GPU server
    if (isDocker) {
      // High quality rendering settings
      viewer.scene.highDynamicRange = true; // Enable HDR rendering
      viewer.scene.logarithmicDepthBuffer = true; // Better depth precision
      viewer.scene.globe.depthTestAgainstTerrain = true; // Proper depth testing
      viewer.scene.globe.showGroundAtmosphere = true; // Show atmospheric scattering
      
      // Increase sample rate for better antialiasing
      viewer.resolutionScale = 1.0; // Use native resolution (1.0 = 100%)
      
      console.log('✅ High-quality graphics settings enabled for GPU rendering');
    }

    return () => {
      if (viewer) {
        viewer.destroy();
      }
    };
  }, [ref]);
}