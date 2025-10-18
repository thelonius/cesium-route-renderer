import React from 'react'
import CesiumViewer from './CesiumViewer'

export default function App() {
  return (
    <div className="app">
      <header className="header">Cesium + Vite + React</header>
      <main className="main">
        <CesiumViewer />
      </main>
    </div>
  )
}
