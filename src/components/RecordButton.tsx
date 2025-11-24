import React, { useState, useRef, useEffect } from 'react';
import * as Cesium from 'cesium';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

interface RecordButtonProps {
  viewer: Cesium.Viewer | null;
  startTime?: Cesium.JulianDate;
  stopTime?: Cesium.JulianDate;
  animationSpeed?: number;
}

export default function RecordButton({ viewer, startTime, stopTime, animationSpeed = 30 }: RecordButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationCheckIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<number | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Calculate estimated recording duration
  useEffect(() => {
    if (startTime && stopTime && animationSpeed) {
      const routeDurationSeconds = Cesium.JulianDate.secondsDifference(stopTime, startTime);
      const recordingDurationSeconds = routeDurationSeconds / animationSpeed;
      // Add 2 seconds for terrain settling
      setEstimatedSeconds(Math.ceil(recordingDurationSeconds + 2));
    }
  }, [startTime, stopTime, animationSpeed]);

  // Initialize FFmpeg
  useEffect(() => {
    const initFFmpeg = async () => {
      try {
        console.log('🔄 Initializing FFmpeg...');
        const ffmpeg = new FFmpeg();
        ffmpegRef.current = ffmpeg;

        ffmpeg.on('log', ({ message }) => {
          console.log('FFmpeg:', message);
        });

        // Track progress
        ffmpeg.on('progress', ({ progress, time }) => {
          const percent = Math.round(progress * 100);
          setConversionProgress(percent);
          console.log(`Conversion progress: ${percent}% (time: ${time}s)`);
        });

        // Load FFmpeg from local files served from public directory
        const baseURL = window.location.origin;
        console.log('📦 Loading FFmpeg core from:', `${baseURL}/ffmpeg/`);
        
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg/ffmpeg-core.wasm`, 'application/wasm'),
        });

        setFfmpegReady(true);
        console.log('✅ FFmpeg initialized and ready for MP4 conversion');
      } catch (error) {
        console.error('❌ Failed to initialize FFmpeg:', error);
        setFfmpegReady(false);
      }
    };

    initFFmpeg();
  }, []);

  // Convert WebM to MP4 using FFmpeg
  const convertToMP4 = async (webmBlob: Blob): Promise<Blob> => {
    if (!ffmpegRef.current) {
      throw new Error('FFmpeg not initialized');
    }

    const ffmpeg = ffmpegRef.current;

    console.log('📹 Starting WebM to MP4 conversion...');
    console.log('FFmpeg loaded:', ffmpeg.loaded);

    // Write input file
    const inputFileName = 'input.webm';
    const outputFileName = 'output.mp4';

    await ffmpeg.writeFile(inputFileName, await fetchFile(webmBlob));
    console.log('✅ Input file written:', inputFileName, 'size:', (webmBlob.size / 1024 / 1024).toFixed(2), 'MB');

    // Convert WebM to MP4 with H.264 codec (Telegram compatible)
    console.log('🔄 Running FFmpeg conversion...');
    await ffmpeg.exec([
      '-i', inputFileName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputFileName
    ]);

    console.log('📦 Reading output file...');
    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName);
    const outputBlob = new Blob([outputData], { type: 'video/mp4' });
    console.log('✅ MP4 conversion complete! Size:', (outputBlob.size / 1024 / 1024).toFixed(2), 'MB');

    // Clean up
    await ffmpeg.deleteFile(inputFileName);
    await ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  };

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

      mediaRecorder.onstop = async () => {
        try {
          setIsConverting(true);
          setConversionProgress(0);
          console.log('Recording finished, converting to MP4...');

          // Check if FFmpeg is ready
          if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
            throw new Error('FFmpeg not ready. Please refresh and try again.');
          }

          const conversionStartTime = Date.now();
          const webmBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });

          // Add timeout to prevent infinite conversion
          const conversionPromise = convertToMP4(webmBlob);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Conversion timeout (60s)')), 60000)
          );

          const mp4Blob = await Promise.race([conversionPromise, timeoutPromise]);
          const conversionTime = ((Date.now() - conversionStartTime) / 1000).toFixed(1);

          const url = URL.createObjectURL(mp4Blob);

          // Create download link
          const a = document.createElement('a');
          a.href = url;
          a.download = `cesium-route-${Date.now()}.mp4`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          console.log(`✅ MP4 saved! Conversion took ${conversionTime}s`);
          setRecordedDuration(0);
          setIsConverting(false);
          setConversionProgress(0);
        } catch (error) {
          console.error('Failed to convert to MP4:', error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          alert(`MP4 conversion failed: ${errorMsg}\nSaving as WebM instead.`);

          // Fallback: save as WebM
          const webmBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(webmBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cesium-route-${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          setRecordedDuration(0);
          setIsConverting(false);
          setConversionProgress(0);
        }
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
      {!isRecording && !isConverting ? (
        <button
          onClick={startRecording}
          disabled={isPreparing || !ffmpegReady}
          style={{
            padding: '12px 20px',
            backgroundColor: (isPreparing || !ffmpegReady) ? '#666' : '#ff4444',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: (isPreparing || !ffmpegReady) ? 'not-allowed' : 'pointer',
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
            {isPreparing ? 'Preparing...' : !ffmpegReady ? 'Loading FFmpeg...' : 'Record MP4'}
          </div>
          {estimatedSeconds && ffmpegReady && (
            <span style={{ fontSize: '11px', opacity: 0.8 }}>
              ~{estimatedSeconds}s @ {animationSpeed}x speed
            </span>
          )}
          {!ffmpegReady && (
            <span style={{ fontSize: '11px', opacity: 0.8 }}>
              Please wait...
            </span>
          )}
        </button>
      ) : isConverting ? (
        <button
          disabled={true}
          style={{
            padding: '12px 20px',
            backgroundColor: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'not-allowed',
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
              backgroundColor: '#ffa500',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 1s linear infinite'
            }} />
            Converting to MP4...
          </div>
          <span style={{ fontSize: '11px', opacity: 0.8 }}>
            {conversionProgress > 0 ? `${conversionProgress}%` : 'Processing...'}
          </span>
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
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
