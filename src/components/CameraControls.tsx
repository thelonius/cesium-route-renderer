import React, { useState, useEffect, useRef } from 'react';
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
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const getViewer = (): Cesium.Viewer | null => {
    return (window as any).__CESIUM_VIEWER || null;
  };

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
        const viewerInstance = getViewer();

        if (viewerInstance && viewerInstance.clock && viewerInstance.clock.startTime) {
          viewerInstance.clock.currentTime = Cesium.JulianDate.clone(viewerInstance.clock.startTime);
          viewerInstance.clock.shouldAnimate = true;
          console.log('🔄 Route restarted from beginning (fallback method)');
        } else {
          console.warn('Could not restart route: viewer or clock not found');
        }
      }
    } catch (e) {
      console.error('Error restarting route:', e);
    }
  };

  const handleStartAnimation = () => {
    try {
      if ((window as any).__startFullAnimation) {
        (window as any).__startFullAnimation();
      } else if ((window as any).__restartRoute) {
        (window as any).__restartRoute();
      }
    } catch (e) {
      console.error('Error starting animation:', e);
    }
  };

  const handleStopAnimation = () => {
    try {
      const viewerInstance = getViewer();
      if (viewerInstance && viewerInstance.clock) {
        viewerInstance.clock.shouldAnimate = false;
        console.log('⏹️ Animation stopped');
      }
    } catch (e) {
      console.error('Error stopping animation:', e);
    }
  };

  const startRecording = async () => {
    const viewer = getViewer();
    if (!viewer) return;

    try {
      const canvas = viewer.scene.canvas;
      const stream = canvas.captureStream(60);

      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 20000000
      };

      if (options.mimeType && !MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8';
        options.videoBitsPerSecond = 15000000;
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cesium-route-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('✅ Recording saved');
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      console.log('🎥 Recording started');
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log('⏹️ Recording stopped');
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

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexDirection: 'column' }}>
        {/* Animation Controls */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={handleStartAnimation} style={{
            flex: 1,
            padding: '8px',
            background: 'rgba(40, 167, 69, 0.3)',
            border: '1px solid rgba(40, 167, 69, 0.6)',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
          }}>
            ▶ Start
          </button>
          <button onClick={handleRestartRoute} style={{
            flex: 1,
            padding: '8px',
            background: 'rgba(0, 123, 255, 0.3)',
            border: '1px solid rgba(0, 123, 255, 0.6)',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
          }}>
            🔄 Restart
          </button>
          <button onClick={handleStopAnimation} style={{
            flex: 1,
            padding: '8px',
            background: 'rgba(220, 53, 69, 0.3)',
            border: '1px solid rgba(220, 53, 69, 0.6)',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
          }}>
            ⏹ Stop
          </button>
        </div>

        {/* Record Button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!getViewer()}
          style={{
            padding: '8px',
            background: isRecording
              ? 'rgba(220, 53, 69, 0.3)'
              : 'rgba(220, 53, 69, 0.2)',
            border: isRecording
              ? '1px solid rgba(220, 53, 69, 0.8)'
              : '1px solid rgba(220, 53, 69, 0.5)',
            color: 'white',
            borderRadius: '4px',
            cursor: getViewer() ? 'pointer' : 'not-allowed',
            fontSize: '12px',
            fontWeight: 'bold',
            opacity: getViewer() ? 1 : 0.5,
          }}
        >
          {isRecording ? '⏹ Stop Recording' : '⏺ Record'}
        </button>

        <button onClick={handleReset} style={{
          padding: '8px',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          color: 'white',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '11px',
        }}>
          Reset Camera
        </button>
      </div>

      <div style={{ marginTop: '12px', fontSize: '10px', opacity: 0.6 }}>
        💡 Tip: Changes apply in real-time. Use keyboard shortcuts: C to toggle controls.
      </div>
    </div>
  );
};
