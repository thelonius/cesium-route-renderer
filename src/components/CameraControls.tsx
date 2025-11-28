import React, { useState, useEffect } from 'react';
import * as Cesium from 'cesium';
import CAMERA from '../../config/constants.json';

interface CameraControlsProps {
  onClose?: () => void;
}

export const CameraControls: React.FC<CameraControlsProps> = ({ onClose }) => {
  const [values, setValues] = useState({
    OFFSET_LOOKAT_X_RATIO: CAMERA.CAMERA.OFFSET_LOOKAT_X_RATIO,
    OFFSET_LOOKAT_Z_RATIO: CAMERA.CAMERA.OFFSET_LOOKAT_Z_RATIO,
    AZIMUTH_MULTIPLIER: CAMERA.CAMERA.AZIMUTH_MULTIPLIER,
    SMOOTH_ALPHA: CAMERA.CAMERA.SMOOTH_ALPHA,
    HIKER_POSITION_SMOOTH_ALPHA: CAMERA.CAMERA.HIKER_POSITION_SMOOTH_ALPHA,
    BASE_HEIGHT: CAMERA.CAMERA.BASE_HEIGHT,
    BASE_BACK: CAMERA.CAMERA.BASE_BACK,
  });

  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    // Apply values on mount and whenever they change
    if (typeof window !== 'undefined' && (window as any).setCameraConstants) {
      (window as any).setCameraConstants(values);
      console.log('🎥 Camera controls updated:', values);
    }
  }, [values]);

  const handleChange = (key: string, value: number) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    const defaults = {
      OFFSET_LOOKAT_X_RATIO: CAMERA.CAMERA.OFFSET_LOOKAT_X_RATIO,
      OFFSET_LOOKAT_Z_RATIO: CAMERA.CAMERA.OFFSET_LOOKAT_Z_RATIO,
      AZIMUTH_MULTIPLIER: CAMERA.CAMERA.AZIMUTH_MULTIPLIER,
      SMOOTH_ALPHA: CAMERA.CAMERA.SMOOTH_ALPHA,
      HIKER_POSITION_SMOOTH_ALPHA: CAMERA.CAMERA.HIKER_POSITION_SMOOTH_ALPHA,
      BASE_HEIGHT: CAMERA.CAMERA.BASE_HEIGHT,
      BASE_BACK: CAMERA.CAMERA.BASE_BACK,
    };
    setValues(defaults);
  };

  const handleRestartRoute = () => {
    try {
      // Use the global restart function exposed by useCesiumAnimation
      if ((window as any).__restartRoute) {
        (window as any).__restartRoute();
      } else {
        // Fallback to basic restart if global function not available
        let viewer = (window as any).Cesium?.Viewer?.instances?.[0];
        if (!viewer) {
          viewer = (window as any).__CESIUM_VIEWER;
        }

        if (viewer && viewer.clock && viewer.clock.startTime) {
          viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.startTime);
          viewer.clock.shouldAnimate = true;
          console.log('🔄 Route restarted from beginning (fallback method)');
        } else {
          console.warn('Could not restart route: viewer or clock not found');
        }
      }
    } catch (e) {
      console.error('Error restarting route:', e);
    }
  };

  if (isMinimized) {
    return (
      <div style={{
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '12px',
        cursor: 'pointer',
        zIndex: 10000,
      }} onClick={() => setIsMinimized(false)}>
        📹 Camera Controls
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      background: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '16px',
      borderRadius: '8px',
      fontSize: '12px',
      maxWidth: '320px',
      maxHeight: '80vh',
      overflowY: 'auto',
      zIndex: 10000,
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <strong style={{ fontSize: '14px' }}>📹 Camera Controls</strong>
        <div>
          <button onClick={() => setIsMinimized(true)} style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: '16px',
          }}>−</button>
          {onClose && (
            <button onClick={onClose} style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '4px 8px',
              fontSize: '16px',
            }}>×</button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          LookAt X Ratio: {values.OFFSET_LOOKAT_X_RATIO.toFixed(2)}
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '8px' }}>
            (0 = centered, 2 = far back)
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={values.OFFSET_LOOKAT_X_RATIO}
          onChange={(e) => handleChange('OFFSET_LOOKAT_X_RATIO', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          LookAt Z Ratio: {values.OFFSET_LOOKAT_Z_RATIO.toFixed(2)}
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '8px' }}>
            (camera tilt)
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          value={values.OFFSET_LOOKAT_Z_RATIO}
          onChange={(e) => handleChange('OFFSET_LOOKAT_Z_RATIO', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          Azimuth Multiplier: {values.AZIMUTH_MULTIPLIER.toFixed(2)}
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '8px' }}>
            (rotation speed)
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="10"
          step="0.1"
          value={values.AZIMUTH_MULTIPLIER}
          onChange={(e) => handleChange('AZIMUTH_MULTIPLIER', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          Smooth Alpha: {values.SMOOTH_ALPHA.toFixed(2)}
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '8px' }}>
            (rotation smoothing)
          </span>
        </label>
        <input
          type="range"
          min="0.01"
          max="1"
          step="0.01"
          value={values.SMOOTH_ALPHA}
          onChange={(e) => handleChange('SMOOTH_ALPHA', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          Hiker Smoothing: {values.HIKER_POSITION_SMOOTH_ALPHA.toFixed(2)}
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '8px' }}>
            (movement smoothing)
          </span>
        </label>
        <input
          type="range"
          min="0.01"
          max="1"
          step="0.01"
          value={values.HIKER_POSITION_SMOOTH_ALPHA}
          onChange={(e) => handleChange('HIKER_POSITION_SMOOTH_ALPHA', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          Base Height: {(values.BASE_HEIGHT / 1000).toFixed(1)}km
        </label>
        <input
          type="range"
          min="5000"
          max="50000"
          step="1000"
          value={values.BASE_HEIGHT}
          onChange={(e) => handleChange('BASE_HEIGHT', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>
          Base Back: {(values.BASE_BACK / 1000).toFixed(1)}km
        </label>
        <input
          type="range"
          min="2000"
          max="30000"
          step="1000"
          value={values.BASE_BACK}
          onChange={(e) => handleChange('BASE_BACK', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button onClick={handleReset} style={{
          flex: 1,
          padding: '8px',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          color: 'white',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
        }}>
          Reset to Defaults
        </button>
        <button onClick={handleRestartRoute} style={{
          flex: 1,
          padding: '8px',
          background: 'rgba(100, 150, 255, 0.2)',
          border: '1px solid rgba(100, 150, 255, 0.5)',
          color: 'white',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
        }}>
          🔄 Restart Route
        </button>
      </div>

      <div style={{ marginTop: '12px', fontSize: '10px', opacity: 0.6 }}>
        💡 Tip: Changes apply in real-time. Use keyboard shortcuts: C to toggle controls.
      </div>
    </div>
  );
};
