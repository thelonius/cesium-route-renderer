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

    // Try to construct the Cesium Viewer, with retries for intermittent failures
    let viewer: Cesium.Viewer | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        viewer = new Cesium.Viewer(ref.current as HTMLDivElement, {
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
          contextOptions: {
            webgl: {
              preserveDrawingBuffer: true // Required for canvas frame capture
            }
          }
        });
        break; // success
      } catch (err) {
        console.warn(`Attempt ${attempt} to create Cesium.Viewer failed:`, err);
        // Small backoff before retry
        if (attempt < maxAttempts) {
          const backoff = 100 * attempt;
          // eslint-disable-next-line no-await-in-loop
          const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
          // synchronous wait via await inside an IIFE not allowed here; instead use blocking setTimeout via Promise
          // but we're in useEffect (async behavior permitted), so perform blocking await by wrapping in async IIFE
          // however to keep code simple, just continue loop and perform a synchronous sleep using Date (not ideal) — instead use a simple delay via busy-wait
          const start = Date.now();
          while (Date.now() - start < backoff) { /* busy wait to allow transient DOM readiness */ }
        }
      }
    }

    if (!viewer) {
      console.error('Failed to create Cesium.Viewer after retries; aborting viewer init');
      try { (window as any).__CESIUM_VIEWER_ERROR = 'Viewer creation failed'; } catch (e) {}
      return;
    }

    // Defensive: ensure viewer.scene exists before touching post-process stages
    try {
      if (isDocker) {
        if (viewer && (viewer as any).scene && (viewer as any).scene.postProcessStages && (viewer as any).scene.postProcessStages.fxaa) {
          (viewer as any).scene.postProcessStages.fxaa.enabled = false;
        }
      }
    } catch (e) {
      console.warn('Could not disable FXAA (viewer.scene missing?):', e);
    }

    // Hide Cesium credits/attribution in Docker mode (defensive)
    try {
      if (isDocker && viewer && (viewer as any).bottomContainer) {
        const creditContainer = (viewer as any).bottomContainer as HTMLElement | undefined;
        if (creditContainer) creditContainer.style.display = 'none';
      }
    } catch (e) {
      console.warn('Could not hide credits (viewer.bottomContainer missing?):', e);
    }

      // Force continuous rendering & performance tuning in Docker (defensive)
    try {
      if (isDocker && viewer && (viewer as any).scene) {
        (viewer as any).scene.requestRenderMode = false;
        (viewer as any).scene.maximumRenderTimeChange = 0;

        // Performance optimizations for Docker mode
        if ((viewer as any).scene.globe) {
          (viewer as any).scene.globe.enableLighting = false; // Disable lighting calculations
          (viewer as any).scene.globe.preloadAncestors = false;
          (viewer as any).scene.globe.preloadSiblings = false;
          (viewer as any).scene.globe.maximumScreenSpaceError = 8; // lower quality for speed
          try { (viewer as any).scene.globe.tileCacheSize = 25; } catch (e) {}
        }
        try { if ((viewer as any).scene.fog) (viewer as any).scene.fog.enabled = false; } catch (e) {}
        try { if ((viewer as any).scene.sun) (viewer as any).scene.sun.show = false; } catch (e) {}
        try { if ((viewer as any).scene.moon) (viewer as any).scene.moon.show = false; } catch (e) {}
      }
    } catch (e) {
      console.warn('Could not apply Docker scene optimizations (viewer.scene missing?):', e);
    }

    if (viewerRef) {
      (viewerRef as any).current = viewer;
    }

    // Diagnostics: ensure Cesium's internal widget was created
    try {
      const widget = (viewer as any)._cesiumWidget;
      if (!widget) {
        console.warn('⚠️ Cesium Viewer created but internal _cesiumWidget is undefined', { viewer });
      } else {
        console.log('✅ Cesium Viewer and internal _cesiumWidget initialized');
      }
    } catch (e) {
      console.warn('Error while checking viewer._cesiumWidget:', e);
    }

    // Expose viewer globally for debug tools and recorder
    try {
      (window as any).__CESIUM_VIEWER = viewer;
    } catch (e) {
      // ignore
    }

    // Verify preserveDrawingBuffer is set correctly (especially important for Docker)
    try {
      if (isDocker && viewer && (viewer as any).scene && (viewer as any).scene.canvas) {
        const canvas = (viewer as any).scene.canvas as HTMLCanvasElement;
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
    } catch (e) {
      console.warn('Could not verify preserveDrawingBuffer (viewer.scene missing?):', e);
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

    // Load imagery - prioritize Bing Maps in all environments with robust fallback
    (async () => {
      try {
        viewer.imageryLayers.removeAll();

        // Try Cesium Ion Bing Maps first (highest quality)
        console.log('🔄 Attempting to load Bing Maps imagery...');
        const ionImagery = await Cesium.IonImageryProvider.fromAssetId(2, {
          // Add timeout and retry options
        });
        viewer.imageryLayers.addImageryProvider(ionImagery);
        console.log('✅ Successfully loaded Bing Maps imagery');

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
    })();

    return () => {
      if (viewer) {
        viewer.destroy();
        try { (window as any).__CESIUM_VIEWER = null; } catch (e) { }
      }
    };
  }, [ref]);
}