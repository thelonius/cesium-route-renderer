import React, { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

export default function CesiumViewer() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ref.current) {
      console.error('Cesium container ref is null')
      return
    }

    console.log('Initializing Cesium viewer...')

    let viewer: Cesium.Viewer | null = null

    const initViewer = async () => {
      try {
        // Configure Cesium baseUrl to load static assets from /cesium
        ;(window as any).CESIUM_BASE_URL = '/cesium/'

        // Set Cesium Ion access token
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjN2Q4M2I1OS1kMDMyLTQ0OTMtOTgzOS1iMWQ5Njg3ZmZiMjgiLCJpZCI6MzUwMDA0LCJpYXQiOjE3NjAzNTM5MzB9.s4oI9AA2RPL7b8WqZKnjrWGONZaSVYjXR-P5iavOLlo'

        // Create viewer first with basic terrain
        viewer = new Cesium.Viewer(ref.current!, {
          timeline: false,
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          navigationHelpButton: false,
          sceneModePicker: false
        })

        console.log('Cesium viewer created successfully')

        // Set initial camera position BEFORE loading terrain
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(-111.8910, 36.0544, 10000),
          orientation: {
            heading: Cesium.Math.toRadians(30.0),
            pitch: Cesium.Math.toRadians(-25.0),
            roll: 0.0
          }
        })

        // Now load terrain asynchronously
        try {
          const terrainProvider = await Cesium.createWorldTerrainAsync({
            requestWaterMask: true,
            requestVertexNormals: true
          })
          viewer.terrainProvider = terrainProvider
          console.log('Terrain loaded successfully')
        } catch (terrainError) {
          console.warn('Could not load terrain, using default:', terrainError)
        }

        // Load Bing Maps imagery
        try {
          viewer.imageryLayers.removeAll()
          const imagery = await Cesium.IonImageryProvider.fromAssetId(2, {})
          viewer.imageryLayers.addImageryProvider(imagery)
        } catch (imageryError) {
          console.warn('Could not load Bing imagery:', imageryError)
        }

        // Fly to closer view after everything is loaded
        setTimeout(() => {
          viewer?.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(-111.8910, 36.0544, 3000),
            orientation: {
              heading: Cesium.Math.toRadians(30.0),
              pitch: Cesium.Math.toRadians(-25.0),
              roll: 0.0
            },
            duration: 3
          })
        }, 1000)
      } catch (error) {
        console.error('Error initializing Cesium:', error)
      }
    }

    initViewer()

    return () => {
      if (viewer) {
        console.log('Destroying Cesium viewer')
        viewer.destroy()
      }
    }
  }, [])

  return <div ref={ref} className="cesium-container" style={{ width: '100%', height: '100%' }} />
}
