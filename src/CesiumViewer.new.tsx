import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import useViewerInit from './hooks/useViewerInit';
import { useRoute } from './hooks/useRoute';
import useCesiumAnimation from './hooks/useCesiumAnimation';
import useCesiumCamera from './components/useCesiumCamera';

export default function CesiumViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [menuVisible, setMenuVisible] = useState(true);
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [currentRoute, setCurrentRoute] = useState<string | null>(null);
  const [showRouteSelector, setShowRouteSelector] = useState(false);
  const [isIntroComplete, setIsIntroComplete] = useState(false);

  // Initialize viewer
  useViewerInit(containerRef, viewerRef);

  // Get route from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gpxFile = urlParams.get('gpx');
    if (gpxFile) {
      setCurrentRoute(`/${gpxFile}`);
    }
  }, []);

  // Load GPX route
  const { trackPoints, timeRange, isLoading, error } = useRoute(currentRoute);

  const hikerEntityRef = useRef<Cesium.Entity | null>(null);

  // Setup animation and camera
  useEffect(() => {
    if (!viewerRef.current || !trackPoints.length || !timeRange) return;

    const entity = useCesiumAnimation({
      viewer: viewerRef.current,
      trackPoints,
      startTime: timeRange.startTime,
      stopTime: timeRange.stopTime
    });

    if (entity) {
      hikerEntityRef.current = entity;
      useCesiumCamera({
        viewer: viewerRef.current,
        targetEntity: entity,
        hikerEntity: entity,
        enableCollisionDetection: false,
        smoothFactor: 0.9,
        isIntroComplete
      });
    }

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.entities.removeAll();
      }
    };
  }, [trackPoints, timeRange]);

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
    window.location.href = `?gpx=${encodeURIComponent(route)}`;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result;
        if (typeof content !== 'string') return;

        if (!content.includes('<?xml') || !content.includes('<gpx')) {
          alert('Invalid GPX file format');
          return;
        }

        const blob = new Blob([content], { type: 'application/gpx+xml' });
        const blobUrl = URL.createObjectURL(blob);
        setAvailableRoutes(prev => [...prev, file.name]);
        window.location.href = `?gpx=${encodeURIComponent(file.name)}`;
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
          padding: '1rem',
          borderRadius: '4px',
        }}>
          Loading route...
        </div>
      )}

      {/* Control Panel */}
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
          {showRouteSelector ? 'Hide Routes' : 'Load Route'}
        </button>

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
                📁 Upload GPX
              </label>
              <input
                id="gpx-upload"
                type="file"
                accept=".gpx"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}