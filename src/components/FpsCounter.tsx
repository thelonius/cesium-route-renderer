import React, { useEffect, useState, useRef } from 'react';

interface FpsCounterProps {
  viewer: Cesium.Viewer | null;
}

export default function FpsCounter({ viewer }: FpsCounterProps) {
  const [fps, setFps] = useState<number>(0);
  const [avgFps, setAvgFps] = useState<number>(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!viewer) return;

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
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: '#00ff00',
      padding: '8px 12px',
      borderRadius: '4px',
      fontFamily: 'monospace',
      fontSize: '14px',
      fontWeight: 'bold',
      zIndex: 1000,
      pointerEvents: 'none',
      lineHeight: '1.4'
    }}>
      <div>FPS: {fps}</div>
      <div style={{ fontSize: '11px', color: '#88ff88' }}>Avg: {avgFps}</div>
    </div>
  );
}
