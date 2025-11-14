import React, { useEffect, useState, useRef } from 'react';

// Type declaration for version injected at build time
declare const __APP_VERSION__: string;

interface FpsCounterProps {
  viewer: Cesium.Viewer | null;
}

interface SystemInfo {
  browser: string;
  os: string;
  memory: string;
  cores: string;
}

interface RenderInfo {
  mapProvider: string;
  terrainQuality: string;
}

export default function FpsCounter({ viewer }: FpsCounterProps) {
  const [fps, setFps] = useState<number>(0);
  const [avgFps, setAvgFps] = useState<number>(0);
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    browser: 'unknown',
    os: 'unknown',
    memory: 'unknown',
    cores: 'unknown'
  });
  const [renderInfo, setRenderInfo] = useState<RenderInfo>({
    mapProvider: 'unknown',
    terrainQuality: 'unknown'
  });
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(performance.now());

  // Get system information
  const getSystemInfo = (): SystemInfo => {
    try {
      const ua = navigator.userAgent;
      let browser = 'unknown';
      let os = 'unknown';

      // Detect browser
      if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
      else if (ua.includes('Firefox')) browser = 'Firefox';
      else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
      else if (ua.includes('Edg')) browser = 'Edge';
      else if (ua.includes('Opera')) browser = 'Opera';

      // Detect OS
      if (ua.includes('Windows')) os = 'Windows';
      else if (ua.includes('Mac')) os = 'macOS';
      else if (ua.includes('Linux')) os = 'Linux';
      else if (ua.includes('Android')) os = 'Android';
      else if (ua.includes('iOS')) os = 'iOS';

      // Get memory info if available
      const memory = (navigator as any).deviceMemory ?
        `${(navigator as any).deviceMemory}GB` : 'unknown';

      // Get CPU cores if available
      const cores = navigator.hardwareConcurrency ?
        `${navigator.hardwareConcurrency} cores` : 'unknown';

      return { browser, os, memory, cores };
    } catch (err) {
      return { browser: 'unknown', os: 'unknown', memory: 'unknown', cores: 'unknown' };
    }
  };

  // Get rendering information
  const getRenderInfo = (viewer: Cesium.Viewer): RenderInfo => {
    try {
      let mapProvider = 'unknown';
      let terrainQuality = 'unknown';

      // Get map provider info
      if (viewer.imageryLayers) {
        const layers = viewer.imageryLayers;
        for (let i = 0; i < layers.length; i++) {
          const layer = layers.get(i);
          if (layer && layer.imageryProvider) {
            const provider = layer.imageryProvider;
            if (provider.constructor.name.includes('IonImageryProvider')) {
              const ionProvider = provider as any;
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
      if (viewer.scene && viewer.scene.globe) {
        const errorValue = viewer.scene.globe.maximumScreenSpaceError;
        terrainQuality = errorValue ? errorValue.toString() : 'unknown';
      }

      return { mapProvider, terrainQuality };
    } catch (err) {
      return { mapProvider: 'unknown', terrainQuality: 'unknown' };
    }
  };

  useEffect(() => {
    if (!viewer) return;

    // Initialize system and render info
    setSystemInfo(getSystemInfo());
    setRenderInfo(getRenderInfo(viewer));

    const updateFps = () => {
      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      // Calculate instantaneous FPS
      const instantFps = 1000 / delta;
      setFps(Math.round(instantFps));

      // Keep last 60 frame times for average
      frameTimesRef.current.push(delta);
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }

      // Calculate average FPS
      const avgDelta = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      setAvgFps(Math.round(1000 / avgDelta));
    };

    // Update on every render frame
    const removeListener = viewer.scene.postRender.addEventListener(updateFps);

    return () => {
      removeListener();
    };
  }, [viewer]);

  if (!viewer) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '10px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: '#00ff00',
      padding: '12px 16px',
      borderRadius: '6px',
      fontFamily: 'monospace',
      fontSize: '12px',
      fontWeight: 'bold',
      zIndex: 1000,
      pointerEvents: 'none',
      lineHeight: '1.4',
      maxWidth: '300px'
    }}>
      <div style={{ marginBottom: '8px' }}>
        <div>FPS: {fps}</div>
        <div style={{ fontSize: '11px', color: '#88ff88' }}>Avg: {avgFps}</div>
        <div style={{ fontSize: '10px', color: '#666666', marginTop: '4px' }}>
          v{__APP_VERSION__}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: '8px', fontSize: '10px' }}>
        <div style={{ color: '#ffff88' }}>
          {systemInfo.browser}/{systemInfo.os}
        </div>
        <div style={{ color: '#ff8888' }}>
          {systemInfo.memory} RAM • {systemInfo.cores}
        </div>
        <div style={{ color: '#88ffff', marginTop: '4px' }}>
          Map: {renderInfo.mapProvider}
        </div>
        <div style={{ color: '#ff88ff' }}>
          Terrain: {renderInfo.terrainQuality}
        </div>
      </div>
    </div>
  );
}
