import React, { useState, useEffect } from 'react'
import CesiumViewer from './CesiumViewer'
import { CameraControls } from './components/CameraControls'

export default function App() {
  const [showControls, setShowControls] = useState(false);

  // Enable intro/outro debug mode - uncomment to test intro/outro only
  (window as any).__DEBUG_INTRO_OUTRO = true;

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        setShowControls(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="app">
      <main className="main">
        <CesiumViewer />
        {showControls && <CameraControls onClose={() => setShowControls(false)} />}
      </main>
    </div>
  )
}
