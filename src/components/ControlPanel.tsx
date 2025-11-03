import React from 'react';
import RouteSelector from './RouteSelector';

interface ControlPanelProps {
  menuVisible: boolean;
  showRouteSelector: boolean;
  toggleMenu: () => void;
  setShowRouteSelector: (show: boolean) => void;
}

export default function ControlPanel({
  menuVisible,
  showRouteSelector,
  toggleMenu,
  setShowRouteSelector
}: ControlPanelProps) {
  return (
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

      {showRouteSelector && <RouteSelector />}
    </div>
  );
}