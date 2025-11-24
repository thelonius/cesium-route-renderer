import React, { useEffect, useState } from 'react';
import * as Cesium from 'cesium';

export default function DebugOverlay() {
  const [state, setState] = useState({
    start: null as string | null,
    stop: null as string | null,
    current: null as string | null,
    multiplier: null as number | null,
    shouldAnimate: null as boolean | null,
    compressed: false,
    cameraHeight: null as number | null,
    routeType: null as string | null,
  });
  const [multiplierInput, setMultiplierInput] = useState('1200');

  useEffect(() => {
    let mounted = true;
    const interval = setInterval(() => {
      try {
        let viewer: Cesium.Viewer | null = null;

        // Try multiple ways to find the viewer
        if ((window as any).Cesium?.Viewer?.instances?.[0]) {
          viewer = (window as any).Cesium.Viewer.instances[0];
          console.log('[DebugOverlay] Found viewer via Cesium.Viewer.instances[0]');
        } else if ((window as any).__CESIUM_VIEWER) {
          viewer = (window as any).__CESIUM_VIEWER;
          console.log('[DebugOverlay] Found viewer via window.__CESIUM_VIEWER');
        } else {
          console.log('[DebugOverlay] No viewer found');
        }

        if (!viewer || !viewer.clock) {
          if (mounted) setState(s => ({ ...s, start: null, stop: null, current: null, multiplier: null, shouldAnimate: null }));
          return;
        }

        const start = viewer.clock.startTime ? Cesium.JulianDate.toIso8601(viewer.clock.startTime) : null;
        const stop = viewer.clock.stopTime ? Cesium.JulianDate.toIso8601(viewer.clock.stopTime) : null;
        const current = viewer.clock.currentTime ? Cesium.JulianDate.toIso8601(viewer.clock.currentTime) : null;
        const multiplier = viewer.clock.multiplier;
        const shouldAnimate = viewer.clock.shouldAnimate;
        const compressed = !!(window as any).__TIMESTAMPS_COMPRESSED;

        // Get camera height above ground
        let cameraHeight: number | null = null;
        try {
          const cameraPos = viewer.camera.positionCartographic;
          if (cameraPos) {
            cameraHeight = Math.round(cameraPos.height);
          }
        } catch (e) {}

        const routeType = (window as any).__ROUTE_TYPE || 'linear';
        if (mounted) setState({ start, stop, current, multiplier, shouldAnimate, compressed, cameraHeight, routeType });
      } catch (e) {
        console.error('[DebugOverlay] Error polling viewer:', e);
      }
    }, 500);

    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <div style={{ position: 'fixed', right: 12, top: 12, zIndex: 9999, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
      <div><strong>Debug</strong></div>
      <div>Start: <code style={{ color: '#9fdf9f' }}>{state.start || 'n/a'}</code></div>
      <div>Stop: <code style={{ color: '#9fdf9f' }}>{state.stop || 'n/a'}</code></div>
      <div>Current: <code style={{ color: '#9fdf9f' }}>{state.current || 'n/a'}</code></div>
      <div>Multiplier: <code style={{ color: '#9fdf9f' }}>{state.multiplier ?? 'n/a'}</code></div>
      <div>Animating: <code style={{ color: '#9fdf9f' }}>{String(state.shouldAnimate)}</code></div>
      <div>Camera height: <code style={{ color: '#9fdf9f' }}>{state.cameraHeight ? `${state.cameraHeight}m` : 'n/a'}</code></div>
      <div>Timestamps compressed: <code style={{ color: '#9fdf9f' }}>{String(state.compressed)}</code></div>
      <div>Route type: <code style={{ color: '#9fdf9f' }}>{state.routeType || 'linear'}</code></div>
      <div style={{ marginTop: 6 }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" onChange={(e) => {
            // allow toggling a global flag to disable compression
            (window as any).__DISABLE_COMPRESSION = e.target.checked;
          }} /> Disable frontend compression
        </label>
        <label style={{ fontSize: 11, marginLeft: 8 }}>
          <input type="checkbox" onChange={(e) => {
            // when enabled, stop the animation hook from overriding multiplier
            (window as any).__MANUAL_MULTIPLIER = e.target.checked;
          }} defaultChecked={!!(window as any).__MANUAL_MULTIPLIER} /> Manual multiplier override
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={multiplierInput} onChange={(e) => setMultiplierInput(e.target.value)} style={{ width: 72, padding: '4px', fontSize: 12 }} />
          <button onClick={() => {
            try {
              const v = Number(multiplierInput) || 1;
              (window as any).__MANUAL_MULTIPLIER = true;
              let viewer: Cesium.Viewer | null = null;
              if ((window as any).Cesium?.Viewer?.instances?.[0]) {
                viewer = (window as any).Cesium.Viewer.instances[0];
              } else if ((window as any).__CESIUM_VIEWER) {
                viewer = (window as any).__CESIUM_VIEWER;
              }
              if (viewer?.clock) {
                viewer.clock.multiplier = v;
                viewer.clock.shouldAnimate = true;
              }
            } catch (e) {
              console.warn('Failed to set multiplier', e);
            }
          }}>Set multiplier</button>
          <button onClick={() => {
            try {
              let viewer: Cesium.Viewer | null = null;
              if ((window as any).Cesium?.Viewer?.instances?.[0]) {
                viewer = (window as any).Cesium.Viewer.instances[0];
              } else if ((window as any).__CESIUM_VIEWER) {
                viewer = (window as any).__CESIUM_VIEWER;
              }
              if (viewer?.clock) {
                (window as any).__MANUAL_MULTIPLIER = true;
                viewer.clock.multiplier = 200;
                viewer.clock.shouldAnimate = true;
              }
            } catch (e) { }
          }}>Fast (200x)</button>
          <button onClick={() => {
            try {
              let viewer: Cesium.Viewer | null = null;
              if ((window as any).Cesium?.Viewer?.instances?.[0]) {
                viewer = (window as any).Cesium.Viewer.instances[0];
              } else if ((window as any).__CESIUM_VIEWER) {
                viewer = (window as any).__CESIUM_VIEWER;
              }
              if (viewer?.clock) {
                (window as any).__MANUAL_MULTIPLIER = true;
                viewer.clock.multiplier = 1;
                viewer.clock.shouldAnimate = true;
              }
            } catch (e) { }
          }}>Normal (1x)</button>
        </div>
      </div>
    </div>
  );
}
