import React from 'react';

interface RouteSelectorProps {
  availableRoutes: string[];
  currentRoute: string;
  handleRouteChange: (route: string) => void;
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function RouteSelector({
  availableRoutes,
  currentRoute,
  handleRouteChange,
  handleFileUpload
}: RouteSelectorProps) {
  return (
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
  );
}