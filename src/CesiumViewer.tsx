import React, { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

interface TrackPoint {
  lat: number
  lon: number
  ele: number
  time: string
}

export default function CesiumViewer() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ref.current) {
      console.error('Cesium container ref is null')
      return
    }

    console.log('Initializing Cesium viewer...')

    let viewer: Cesium.Viewer | null = null

    const parseGPX = async (url: string): Promise<TrackPoint[]> => {
      const response = await fetch(url)
      const gpxText = await response.text()
      const parser = new DOMParser()
      const gpxDoc = parser.parseFromString(gpxText, 'text/xml')

      const trackPoints: TrackPoint[] = []
      const trkpts = gpxDoc.querySelectorAll('trkpt')

      trkpts.forEach(trkpt => {
        const lat = parseFloat(trkpt.getAttribute('lat') || '0')
        const lon = parseFloat(trkpt.getAttribute('lon') || '0')
        const ele = parseFloat(trkpt.querySelector('ele')?.textContent || '0')
        const time = trkpt.querySelector('time')?.textContent || ''

        trackPoints.push({ lat, lon, ele, time })
      })

      return trackPoints
    }

    const initViewer = async () => {
      try {
        // Configure Cesium baseUrl to load static assets from /cesium
        ;(window as any).CESIUM_BASE_URL = '/cesium/'

        // Set Cesium Ion access token
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjN2Q4M2I1OS1kMDMyLTQ0OTMtOTgzOS1iMWQ5Njg3ZmZiMjgiLCJpZCI6MzUwMDA0LCJpYXQiOjE3NjAzNTM5MzB9.s4oI9AA2RPL7b8WqZKnjrWGONZaSVYjXR-P5iavOLlo'

        // Create viewer first with basic terrain
        viewer = new Cesium.Viewer(ref.current!, {
          timeline: true,
          animation: true,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          shouldAnimate: true
        })

        console.log('Cesium viewer created successfully')

        // Parse GPX file
        console.log('Loading GPX file...')
        const trackPoints = await parseGPX('/alps-trail.gpx')
        console.log(`Loaded ${trackPoints.length} track points`)

  // Ensure clamped graphics render correctly against terrain
  viewer.scene.globe.depthTestAgainstTerrain = true

        if (trackPoints.length === 0) {
          console.error('No track points found in GPX file')
          return
        }

        // Set initial camera position to Alps
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            trackPoints[0].lon,
            trackPoints[0].lat,
            300
          ),
          orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-45.0),
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

        // Create time-based positions for animation
        const startTime = Cesium.JulianDate.fromIso8601(trackPoints[0].time)
        const stopTime = Cesium.JulianDate.fromIso8601(trackPoints[trackPoints.length - 1].time)

        // Set viewer clock
        viewer.clock.startTime = startTime.clone()
        viewer.clock.stopTime = stopTime.clone()
        viewer.clock.currentTime = startTime.clone()
        viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP
        viewer.clock.multiplier = 10 // Speed up animation

        // Set timeline bounds
        viewer.timeline.zoomTo(startTime, stopTime)

        // Pre-sample terrain heights for the route to avoid per-frame height flicker
        const cartographics = trackPoints.map(p => Cesium.Cartographic.fromDegrees(p.lon, p.lat))
        let sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)

        // Apply a simple moving average to smooth any residual noise in heights
        const windowSize = 3
        const smoothedHeights = sampled.map((c, i, arr) => {
          let sum = 0
          let count = 0
          for (let k = -Math.floor(windowSize / 2); k <= Math.floor(windowSize / 2); k++) {
            const idx = i + k
            if (idx >= 0 && idx < arr.length) {
              sum += arr[idx].height
              count++
            }
          }
          return count > 0 ? sum / count : c.height
        })

        // Build position property with lat/lon only (height will be clamped to ground)
        const hikerPositions = new Cesium.SampledPositionProperty()
        for (let i = 0; i < trackPoints.length; i++) {
          const t = Cesium.JulianDate.fromIso8601(trackPoints[i].time)
          const c = sampled[i]
          // Use zero height - will be clamped to actual terrain
          const pos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0)
          hikerPositions.addSample(t, pos)
        }
        hikerPositions.setInterpolationOptions({
          interpolationAlgorithm: Cesium.LinearApproximation,
          interpolationDegree: 1
        })

        // Create entity for the hiker with ground clamping
        const hikerEntity = viewer.entities.add({
          availability: new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({
              start: startTime,
              stop: stopTime
            })
          ]),
          position: hikerPositions,
          point: {
            pixelSize: 12,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: 'Hiker',
            font: '14pt sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        })

        // Create a dynamic trail that follows the hiker with ground clamping
        const trailPositions: Cesium.Cartesian3[] = []
        const trailEntity = viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              return trailPositions.length > 1 ? trailPositions : []
            }, false),
            width: 8,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.3,
              color: Cesium.Color.YELLOW
            }),
            clampToGround: true
          }
        })

        // Update trail positions on each frame using the hiker's stable position
        let lastAddedTime = Cesium.JulianDate.clone(startTime)
        const ADD_INTERVAL_SECONDS = 0.5
        viewer.scene.preRender.addEventListener(() => {
          if (!viewer) return
          const currentTime = viewer.clock.currentTime
          const currentPosition = hikerEntity.position?.getValue(currentTime)
          if (!currentPosition) return

          const dt = Cesium.JulianDate.secondsDifference(currentTime, lastAddedTime)
          if (dt < ADD_INTERVAL_SECONDS && trailPositions.length > 0) return

          // Use the entity's current position (already height-stable via pre-sampled data)
          trailPositions.push(currentPosition.clone())
          lastAddedTime = Cesium.JulianDate.clone(currentTime)
        })

        // The yellow trail dynamically shows where the hiker has traveled
        // No need for a separate full route polyline

  // Follow the hiker entity for camera tracking
  viewer.trackedEntity = hikerEntity

  console.log('Route loaded and animation started!')

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
