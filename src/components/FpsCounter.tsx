import React, { useEffect, useState, useRef } from 'react';
import * as Cesium from 'cesium';

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
  const [animationSpeed, setAnimationSpeed] = useState<number>(0);
  const [avgFrameTime, setAvgFrameTime] = useState<number>(0);
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

      // Get memory info if available (deviceMemory is in GB)
      const memoryGB = (navigator as any).deviceMemory;
      const memory = memoryGB ? `${memoryGB}GB` : 'Unknown';

      // Get CPU cores if available
      const cores = navigator.hardwareConcurrency || 'Unknown';
      const coresStr = typeof cores === 'number' ? `${cores} cores` : cores;

      return { browser, os, memory, cores: coresStr };
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

      // Calculate average FPS and frame time
      const avgDelta = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      setAvgFps(Math.round(1000 / avgDelta));
      setAvgFrameTime(avgDelta);

      // Update animation speed
      if (viewer?.clock?.multiplier !== undefined) {
        setAnimationSpeed(viewer.clock.multiplier);
      }
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
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: '#00ff00',
      padding: '16px 20px',
      borderRadius: '8px',
      fontFamily: 'monospace',
      fontSize: '13px',
      fontWeight: 'bold',
      zIndex: 1000,
      pointerEvents: 'none',
      lineHeight: '1.5',
      maxWidth: '350px',
      border: '1px solid #333',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
    }}>
      {/* Performance Section */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', marginBottom: '4px' }}>
          FPS: <span style={{ color: '#00ffff' }}>{fps}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#88ff88' }}>
          Avg: {avgFps} FPS ({avgFrameTime.toFixed(2)}ms)
        </div>
        <div style={{ fontSize: '11px', color: '#666666', marginTop: '6px' }}>
          Build: v{__APP_VERSION__}
        </div>
      </div>

      {/* System Section */}
      <div style={{ borderTop: '1px solid #444', paddingTop: '12px', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#ffff88', marginBottom: '6px' }}>
          🖥️  {systemInfo.browser}/{systemInfo.os}
        </div>
        <div style={{ fontSize: '12px', color: '#ff8888', marginBottom: '6px' }}>
          🧠 RAM: {systemInfo.memory} • CPU: {systemInfo.cores}
        </div>
      </div>

      {/* Rendering Section */}
      <div style={{ borderTop: '1px solid #444', paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: '#88ffff', marginBottom: '6px' }}>
          🗺️  Map: {renderInfo.mapProvider}
        </div>
        <div style={{ fontSize: '12px', color: '#ff88ff', marginBottom: '6px' }}>
          🏔️  Terrain: {renderInfo.terrainQuality}
        </div>
        <div style={{ fontSize: '12px', color: '#ffffff' }}>
          ⚡ Speed: {animationSpeed.toFixed(1)}x
        </div>
      </div>
    </div>
  );
}
