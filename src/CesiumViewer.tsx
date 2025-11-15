import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import useViewerInit from './hooks/useViewerInit';
import { useRoute } from './hooks/useRoute';
import useCesiumAnimation from './hooks/useCesiumAnimation';
import useCesiumCamera from './hooks/useCesiumCamera';
import FpsCounter from './components/FpsCounter';
import RecordButton from './components/RecordButton';

export default function CesiumViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const entityRef = useRef<Cesium.Entity | null>(null);
  const [menuVisible, setMenuVisible] = useState(true);
  const [availableRoutes, setAvailableRoutes] = useState<string[]>(['alps-trail.gpx', 'virages.gpx']);
  const [currentRoute, setCurrentRoute] = useState<string | null>(null);
  const [showRouteSelector, setShowRouteSelector] = useState(false);
  const [isIntroComplete, setIsIntroComplete] = useState(false);
  const [routeValidated, setRouteValidated] = useState(false);
  const [isDockerMode, setIsDockerMode] = useState(false);

  // Check if running in Docker mode (URL parameter or environment variable)
  useEffect(() => {
    // Check URL parameters first (Docker mode with Puppeteer)
    const urlParams = new URLSearchParams(window.location.search);
    const gpxFromUrl = urlParams.get('gpx');
    const animationSpeedParam = urlParams.get('animationSpeed');

    // Check environment variable (alternative Docker mode)
    const gpxFromEnv = import.meta.env.VITE_GPX_ROUTE;

    console.log('Docker mode detection:', {
      urlParam: gpxFromUrl,
      animationSpeed: animationSpeedParam,
      envVar: gpxFromEnv,
      allEnv: import.meta.env
    });

    // URL parameter takes precedence (Puppeteer passes it this way)
    const dockerRoute = gpxFromUrl || gpxFromEnv;

    if (dockerRoute && typeof dockerRoute === 'string' && dockerRoute.trim()) {
      console.log('Running in Docker mode with route:', dockerRoute, 'animation speed:', animationSpeedParam || 'default');
      setIsDockerMode(true);
      setCurrentRoute(dockerRoute);
      setRouteValidated(true);
    } else {
      console.log('Running in Web mode - waiting for user to select route');
      // In web mode, show route selector by default
      setShowRouteSelector(true);
    }
  }, []);

  // Initialize viewer
  useViewerInit(containerRef, viewerRef);

  // Load GPX route only if validated
  const { trackPoints, timeRange, isLoading, error } = useRoute(routeValidated ? currentRoute : null);

  // Get animation speed from URL params (for Docker mode)
  const animationSpeed = React.useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const speedParam = urlParams.get('animationSpeed');
    return speedParam ? parseInt(speedParam, 10) : 4; // Default to 4x speed
  }, []);

  // Setup animation - called at top level
  const entity = useCesiumAnimation({
    viewer: viewerRef.current,
    trackPoints,
    startTime: timeRange?.startTime,
    stopTime: timeRange?.stopTime,
    animationSpeed
  });

  // Setup camera - called at top level
  useCesiumCamera({
    viewer: viewerRef.current,
    targetEntity: entity,
    hikerEntity: entity,
    isIntroComplete: true,
    enableCollisionDetection: false,
    smoothFactor: 0.9
  });

  // Track entity reference
  useEffect(() => {
    if (entity) {
      entityRef.current = entity;
      setIsIntroComplete(true);
    }
    return () => {
      entityRef.current = null;
    };
  }, [entity]);

  // Toggle menu visibility
  useEffect(() => {
    if (viewerRef.current) {
      const viewer = viewerRef.current;
      const animationContainer = viewer.animation?.container as HTMLElement;
      const timelineContainer = viewer.timeline?.container as HTMLElement;

      if (animationContainer) {
        animationContainer.style.display = menuVisible ? 'block' : 'none';
      }
      if (timelineContainer) {
        timelineContainer.style.display = menuVisible ? 'block' : 'none';
      }
    }
  }, [menuVisible]);

  const toggleMenu = () => {
    setMenuVisible(!menuVisible);
  };

  const handleRouteChange = (route: string) => {
    setCurrentRoute(route);
    setRouteValidated(true);
    setShowRouteSelector(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result;
        if (typeof content !== 'string') return;

        const isGPX = content.includes('<?xml') && content.includes('<gpx');
        const isKML = content.includes('<?xml') && content.includes('<kml');

        if (!isGPX && !isKML) {
          alert('Invalid file format. Please upload a GPX or KML file.');
          return;
        }

        const mimeType = isKML ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml';
        const blob = new Blob([content], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        setAvailableRoutes(prev => [...prev, file.name]);
        setCurrentRoute(blobUrl);
        setRouteValidated(true);
        setShowRouteSelector(false);
      };
      reader.readAsText(file);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file');
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className="cesium-container" style={{ width: '100%', height: '100%' }} />

      {/* FPS Counter for debugging */}
      <FpsCounter viewer={viewerRef.current} />

      {/* Record Button for web mode */}
      <RecordButton
        viewer={viewerRef.current}
        startTime={timeRange?.startTime}
        stopTime={timeRange?.stopTime}
        animationSpeed={animationSpeed}
      />

      {/* Welcome Screen - Show only in web mode when no route selected */}
      {!isDockerMode && !routeValidated && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
        }}>
          <h1 style={{
            color: 'white',
            fontSize: '32px',
            fontFamily: 'sans-serif',
            marginBottom: '20px',
          }}>
            Welcome to Cesium Route Viewer
          </h1>
          <p style={{
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: '16px',
            fontFamily: 'sans-serif',
            marginBottom: '40px',
          }}>
            Please select a route to begin
          </p>

          {/* Route Selection */}
          <div style={{
            padding: '24px',
            backgroundColor: 'rgba(42, 42, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            minWidth: '300px',
            maxWidth: '500px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            <h3 style={{
              margin: '0 0 16px 0',
              color: 'white',
              fontSize: '18px',
              fontFamily: 'sans-serif',
              fontWeight: 'bold'
            }}>
              Available Routes
            </h3>

            {/* Route List */}
            <div style={{ marginBottom: '16px' }}>
              {availableRoutes.map((route) => (
                <div
                  key={route}
                  onClick={() => handleRouteChange(route)}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    backgroundColor: 'rgba(100, 149, 237, 0.2)',
                    border: '1px solid rgba(100, 149, 237, 0.4)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '14px',
                    fontFamily: 'sans-serif',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(100, 149, 237, 0.4)';
                    e.currentTarget.style.borderColor = 'rgba(100, 149, 237, 0.6)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(100, 149, 237, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(100, 149, 237, 0.4)';
                  }}
                >
                  📍 {route.replace('.gpx', '')}
                </div>
              ))}
            </div>

            {/* File Upload */}
            <div>
              <label
                htmlFor="gpx-upload-welcome"
                style={{
                  display: 'block',
                  padding: '12px',
                  backgroundColor: 'rgba(34, 139, 34, 0.3)',
                  border: '1px solid rgba(34, 139, 34, 0.5)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '14px',
                  fontFamily: 'sans-serif',
                  textAlign: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.3)';
                }}
              >
                📁 Upload GPX or KML File
              </label>
              <input
                id="gpx-upload-welcome"
                type="file"
                accept=".gpx,.kml"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(255, 0, 0, 0.8)',
          color: 'white',
          padding: '1rem',
          borderRadius: '4px',
          zIndex: 1500,
        }}>
          {error}
        </div>
      )}

      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '1.5rem',
          borderRadius: '4px',
          zIndex: 1500,
          textAlign: 'center',
        }}>
          <div style={{ marginBottom: '10px', fontSize: '16px' }}>Loading and validating route...</div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>Please wait</div>
        </div>
      )}

      {/* Control Panel - Only show in web mode (not Docker) after route is loaded */}
      {!isDockerMode && routeValidated && !error && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <button
            onClick={toggleMenu}
            style={{
              padding: '8px 16px',
              backgroundColor: 'rgba(42, 42, 42, 0.8)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontFamily: 'sans-serif'
            }}
          >
            {menuVisible ? 'Hide Controls' : 'Show Controls'}
          </button>

          {!isDockerMode && (
            <button
              onClick={() => setShowRouteSelector(!showRouteSelector)}
              style={{
                padding: '8px 16px',
                backgroundColor: 'rgba(42, 42, 42, 0.8)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontFamily: 'sans-serif'
              }}
            >
              {showRouteSelector ? 'Hide Routes' : 'Change Route'}
            </button>
          )}

          {/* Route Selector Panel */}
          {showRouteSelector && (
          <div style={{
            padding: '12px',
            backgroundColor: 'rgba(42, 42, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            minWidth: '200px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            <h3 style={{
              margin: '0 0 12px 0',
              color: 'white',
              fontSize: '14px',
              fontFamily: 'sans-serif',
              fontWeight: 'bold'
            }}>
              Available Routes
            </h3>

            {/* Route List */}
            <div style={{ marginBottom: '12px' }}>
              {availableRoutes.map((route) => (
                <div
                  key={route}
                  onClick={() => handleRouteChange(route)}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    backgroundColor: currentRoute === route
                      ? 'rgba(100, 149, 237, 0.3)'
                      : 'rgba(255, 255, 255, 0.1)',
                    border: currentRoute === route
                      ? '1px solid rgba(100, 149, 237, 0.5)'
                      : '1px solid transparent',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '13px',
                    fontFamily: 'sans-serif',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (currentRoute !== route) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentRoute !== route) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                >
                  {route.replace('.gpx', '')}
                </div>
              ))}
            </div>

            {/* File Upload */}
            <div>
              <label
                htmlFor="gpx-upload"
                style={{
                  display: 'block',
                  padding: '8px',
                  backgroundColor: 'rgba(34, 139, 34, 0.3)',
                  border: '1px solid rgba(34, 139, 34, 0.5)',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '13px',
                  fontFamily: 'sans-serif',
                  textAlign: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.3)';
                }}
              >
                📁 Upload GPX/KML
              </label>
              <input
                id="gpx-upload"
                type="file"
                accept=".gpx,.kml"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}