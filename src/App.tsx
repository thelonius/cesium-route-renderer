import React, { useState, useEffect } from 'react'
import CesiumViewer from './CesiumViewer'
import { CameraControls } from './components/CameraControls'

export default function App() {
  const [showControls, setShowControls] = useState(false);

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
