import React, { useState, useRef, useEffect } from 'react';
import * as Cesium from 'cesium';

interface RecordButtonProps {
  viewer: Cesium.Viewer | null;
  startTime?: Cesium.JulianDate;
  stopTime?: Cesium.JulianDate;
  animationSpeed?: number;
}

export default function RecordButton({ viewer, startTime, stopTime, animationSpeed = 30 }: RecordButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationCheckIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<number | null>(null);

  // Calculate estimated recording duration
  useEffect(() => {
    if (startTime && stopTime && animationSpeed) {
      const routeDurationSeconds = Cesium.JulianDate.secondsDifference(stopTime, startTime);
      const recordingDurationSeconds = routeDurationSeconds / animationSpeed;
      // Add 2 seconds for terrain settling
      setEstimatedSeconds(Math.ceil(recordingDurationSeconds + 2));
    }
  }, [startTime, stopTime, animationSpeed]);

  const startRecording = async () => {
    if (!viewer) return;

    try {
      setIsPreparing(true);
      const canvas = viewer.scene.canvas;

      // Get canvas stream at 60 FPS for smoother video
      const stream = canvas.captureStream(60);

      // Create media recorder with high quality settings
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 20000000 // 20 Mbps for high quality
      };

      // Fallback to vp8 if vp9 not supported
      if (options.mimeType && !MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8';
        options.videoBitsPerSecond = 15000000; // 15 Mbps for vp8
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = `cesium-route-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('Recording saved');
        setRecordedDuration(0);
      };

      mediaRecorder.start(100); // Collect data every 100ms for better quality
      setIsRecording(true);
      setIsPreparing(false);
      console.log('Recording started at 60 FPS, 20 Mbps using canvas.captureStream()');

      // Update duration counter
      durationIntervalRef.current = window.setInterval(() => {
        setRecordedDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Check if animation has completed
      if (stopTime) {
        animationCheckIntervalRef.current = window.setInterval(() => {
          if (!viewer.clock.shouldAnimate ||
              Cesium.JulianDate.compare(viewer.clock.currentTime, stopTime) >= 0) {
            console.log('Animation completed, stopping recording automatically');
            stopRecording();
          }
        }, 500); // Check every 500ms
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsPreparing(false);
      alert('Failed to start recording. Please check console for details.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log('Recording stopped');
    }

    if (animationCheckIntervalRef.current) {
      clearInterval(animationCheckIntervalRef.current);
      animationCheckIntervalRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  if (!viewer) return null;

  // Check if in Docker mode (don't show button)
  const isDocker = window.location.search.includes('docker=true');
  if (isDocker) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000
    }}>
      {!isRecording ? (
        <button
          onClick={startRecording}
          disabled={isPreparing}
          style={{
            padding: '12px 20px',
            backgroundColor: isPreparing ? '#666' : '#ff4444',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: isPreparing ? 'not-allowed' : 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '12px',
              height: '12px',
              backgroundColor: 'white',
              borderRadius: '50%',
              display: 'inline-block'
            }} />
            {isPreparing ? 'Preparing...' : 'Start Recording'}
          </div>
          {estimatedSeconds && (
            <span style={{ fontSize: '11px', opacity: 0.8 }}>
              ~{estimatedSeconds}s @ {animationSpeed}x speed
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={stopRecording}
          style={{
            padding: '12px 20px',
            backgroundColor: '#444',
            color: 'white',
            border: '2px solid #ff4444',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            animation: 'pulse 1.5s ease-in-out infinite'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '12px',
              height: '12px',
              backgroundColor: '#ff4444',
              borderRadius: '2px',
              display: 'inline-block'
            }} />
            Stop Recording
          </div>
          <span style={{ fontSize: '11px', opacity: 0.8 }}>
            {recordedDuration}s recorded
          </span>
        </button>
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
