import React, { useEffect, useRef, useState } from 'react'
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
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const [menuVisible, setMenuVisible] = useState(true)
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([])
  const [currentRoute, setCurrentRoute] = useState<string>('')
  const [showRouteSelector, setShowRouteSelector] = useState(false)

  // Load available routes on mount
  useEffect(() => {
    const loadRoutes = async () => {
      try {
        // Check for available GPX files
        const routes = ['alps-trail.gpx', 'virages.gpx']
        setAvailableRoutes(routes)
      } catch (error) {
        console.error('Error loading routes:', error)
      }
    }
    loadRoutes()
  }, [])

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

        // Check if running in Docker/headless environment
        const isDocker = navigator.userAgent.includes('HeadlessChrome')
        console.log('Running in Docker/Headless:', isDocker)

        // Create viewer with appropriate settings
        viewer = new Cesium.Viewer(ref.current!, {
          timeline: true,
          animation: true,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          shouldAnimate: true,
          requestRenderMode: !isDocker, // Disable for Docker
          maximumRenderTimeChange: isDocker ? 0 : Infinity
        })

        // Reduce post-processing cost (FXAA) in software GL / headless runs which can
        // materially improve achievable FPS. Use a safe try/catch in case the API
        // isn't available in some Cesium builds.
        try {
          if (viewer && viewer.scene && viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = false
            console.log('Disabled FXAA post-process for better performance')
          }
        } catch (e) {
          console.warn('Could not disable FXAA (non-fatal):', e)
        }

        // Force scene to render continuously in Docker
        if (isDocker) {
          viewer.scene.requestRenderMode = false
          viewer.scene.maximumRenderTimeChange = 0
        }

        viewerRef.current = viewer

        // Runtime diagnostics and global error handlers to capture DeveloperError state
        const dumpDiagnostics = (tag: string, err?: any) => {
          try {
            const now = viewer && viewer.clock && viewer.clock.currentTime ? Cesium.JulianDate.toIso8601(viewer.clock.currentTime) : new Date().toISOString()
            const trackedPos = (viewer && hikerEntity && hikerEntity.position) ? hikerEntity.position.getValue(viewer.clock.currentTime) : null
            let trackedCarto = null
            if (trackedPos) {
              try {
                const c = Cesium.Cartographic.fromCartesian(trackedPos)
                trackedCarto = {
                  lon: Cesium.Math.toDegrees(c.longitude),
                  lat: Cesium.Math.toDegrees(c.latitude),
                  height: c.height
                }
              } catch (e) {
                trackedCarto = { error: 'fromCartesian failed', e }
              }
            }

            // last few trail points
            const lastTrail = (window as any).__lastTrailSnapshot || []

            const cam = viewer && viewer.camera && viewer.camera.positionCartographic ? viewer.camera.positionCartographic : null
            const camInfo = cam
              ? { lat: Cesium.Math.toDegrees(cam.latitude), lon: Cesium.Math.toDegrees(cam.longitude), height: cam.height }
              : null

            const globe = viewer && viewer.scene && viewer.scene.globe ? { tilesLoaded: viewer.scene.globe.tilesLoaded, show: viewer.scene.globe.show } : null

            console.error(`DIAG ${tag}: time=${now} tracked=${JSON.stringify(trackedCarto)} trailPoints=${lastTrail.length} camera=${JSON.stringify(camInfo)} globe=${JSON.stringify(globe)} err=${err && (err.stack || err.message || err)}`)
          } catch (e) {
            console.error('DIAG dump failed', e)
          }
        }

        const onWindowError = (event: ErrorEvent) => {
          try {
            console.error('window.onerror captured:', event.error || event.message)
            dumpDiagnostics('window.onerror', event.error || event.message)
            ;(window as any).CESIUM_RENDER_ERROR = true
            // If this looks like a Cesium DeveloperError, disable camera tracking to avoid repeat
            if (event.message && event.message.toLowerCase().includes('developererror')) {
              try { if (viewer) viewer.trackedEntity = undefined } catch (e) {}
            }
          } catch (e) { console.error('onWindowError handler failed', e) }
        }

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
          try {
            console.error('unhandledrejection captured:', event.reason)
            dumpDiagnostics('unhandledrejection', event.reason)
            ;(window as any).CESIUM_RENDER_ERROR = true
            const msg = event.reason && (event.reason.message || String(event.reason))
            if (msg && msg.toLowerCase().includes('developererror')) {
              try { if (viewer) viewer.trackedEntity = undefined } catch (e) {}
            }
          } catch (e) { console.error('onUnhandledRejection handler failed', e) }
        }

  // Store references for cleanup
  ;(window as any).__onWindowError = onWindowError
  ;(window as any).__onUnhandledRejection = onUnhandledRejection
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  // Expose dump helper for other places to call when catching errors
  ;(window as any).CESIUM_DUMP = dumpDiagnostics

        // Parse GPX file
        const urlParams = new URLSearchParams(window.location.search)
        const gpxFile = urlParams.get('gpx') || 'virages.gpx'
        setCurrentRoute(gpxFile)
        console.log('Fetching GPX from:', `/${gpxFile}`)
        const trackPoints = await parseGPX(`/${gpxFile}`)
        console.log(`✓ Loaded ${trackPoints.length} track points from GPX`)

        if (trackPoints.length === 0) {
          console.error('❌ No track points found in GPX file')
          return
        }

        console.log('First point:', trackPoints[0])
        console.log('Last point:', trackPoints[trackPoints.length - 1])

        // Ensure viewer is still valid after async operations
        if (!viewer || !viewer.scene) {
          console.error('❌ Viewer became invalid after GPX parsing')
          return
        }

        // Ensure clamped graphics render correctly against terrain
        viewer.scene.globe.depthTestAgainstTerrain = true

        // Force globe to show immediately
        viewer.scene.globe.show = true
        viewer.scene.globe.enableLighting = false
        viewer.scene.skyBox.show = true
        viewer.scene.sun.show = true
        viewer.scene.moon.show = false

        // Set initial camera position
        const cameraPos = Cesium.Cartesian3.fromDegrees(
          trackPoints[0].lon,
          trackPoints[0].lat,
          5000 // Increased altitude to see globe better
        )
        viewer.camera.setView({
          destination: cameraPos,
          orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-45.0),
            roll: 0.0
          }
        })

        console.log('✓ Camera set to:', {
          lat: trackPoints[0].lat,
          lon: trackPoints[0].lon,
          altitude: 5000,
          pitch: -45
        })
        console.log('✓ Globe show:', viewer.scene.globe.show)
        console.log('✓ Scene mode:', viewer.scene.mode)

        // Load terrain (skip in Docker if it fails)
        try {
          const terrainProvider = await Cesium.createWorldTerrainAsync({
            requestWaterMask: false, // Disable for performance
            requestVertexNormals: false
          })
          viewer.terrainProvider = terrainProvider
          console.log('Terrain loaded successfully')
        } catch (terrainError) {
          console.warn('Could not load terrain, using ellipsoid:', terrainError)
          // Use default ellipsoid terrain in Docker
        }

        // Load imagery - prefer Cesium Ion world imagery first, fallback to OpenStreetMap
        try {
          viewer.imageryLayers.removeAll()

          // Try Cesium Ion imagery (assetId 2 is the Cesium World Imagery/Bing-backed provider)
          // This requires Cesium.Ion.defaultAccessToken to be set above.
          const ionImagery = await Cesium.IonImageryProvider.fromAssetId(2, {})
          viewer.imageryLayers.addImageryProvider(ionImagery)
          console.log('✓ Cesium Ion world imagery loaded')
        } catch (ionErr) {
          console.warn('⚠️ Could not load Cesium Ion imagery, falling back to OpenStreetMap:', ionErr)
          try {
            const osm = new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/'
            })
            viewer.imageryLayers.addImageryProvider(osm)
            console.log('✓ Fallback: OpenStreetMap imagery loaded')
          } catch (osmErr) {
            console.error('❌ Could not load any imagery provider:', osmErr)
          }
        }

        // Create time-based positions for animation
        let startTime: Cesium.JulianDate
        let stopTime: Cesium.JulianDate

        // Check if GPX has timestamps
        const hasTimestamps = trackPoints[0].time && trackPoints[0].time !== ''

        if (hasTimestamps) {
          // Use actual GPX timestamps
          startTime = Cesium.JulianDate.fromIso8601(trackPoints[0].time)
          stopTime = Cesium.JulianDate.fromIso8601(trackPoints[trackPoints.length - 1].time)
        } else {
          // Generate realistic timestamps based on walking speed (5 km/h)
          console.log('GPX has no timestamps, calculating based on 5 km/h walking speed')

          const WALKING_SPEED_KMH = 5
          const WALKING_SPEED_MS = (WALKING_SPEED_KMH * 1000) / 3600 // meters per second

          startTime = Cesium.JulianDate.now()
          let cumulativeTime = 0

          // Calculate time for each segment based on distance
          for (let i = 0; i < trackPoints.length; i++) {
            if (i === 0) {
              trackPoints[i].time = Cesium.JulianDate.toIso8601(startTime)
            } else {
              // Calculate distance between previous and current point
              const prevPos = Cesium.Cartographic.fromDegrees(
                trackPoints[i - 1].lon,
                trackPoints[i - 1].lat,
                trackPoints[i - 1].ele
              )
              const currPos = Cesium.Cartographic.fromDegrees(
                trackPoints[i].lon,
                trackPoints[i].lat,
                trackPoints[i].ele
              )

              // Calculate geodesic distance using Cesium's ellipsoid
              const distance = Cesium.Cartesian3.distance(
                Cesium.Cartesian3.fromRadians(prevPos.longitude, prevPos.latitude, prevPos.height),
                Cesium.Cartesian3.fromRadians(currPos.longitude, currPos.latitude, currPos.height)
              )

              // Calculate time to walk this distance at 5 km/h
              const timeForSegment = distance / WALKING_SPEED_MS
              cumulativeTime += timeForSegment

              const pointTime = Cesium.JulianDate.addSeconds(startTime, cumulativeTime, new Cesium.JulianDate())
              trackPoints[i].time = Cesium.JulianDate.toIso8601(pointTime)
            }
          }

          stopTime = Cesium.JulianDate.fromIso8601(trackPoints[trackPoints.length - 1].time)

          const totalMinutes = cumulativeTime / 60
          console.log(`Route duration at 5 km/h: ${totalMinutes.toFixed(1)} minutes`)
        }

        // Set viewer clock
        viewer.clock.startTime = startTime.clone()
        viewer.clock.stopTime = stopTime.clone()
        viewer.clock.currentTime = startTime.clone()
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP

  // Allow playback speed to be controlled via URL param `speed` so recorder
  // and viewer stay in sync. Default speed multiplier is 10 (same as recorder default).
  const urlParamsInner = new URLSearchParams(window.location.search)
  const speedParam = parseInt(urlParamsInner.get('speed') || '')
  const speedMultiplier = Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 10
  viewer.clock.multiplier = speedMultiplier

        // Set timeline bounds
        viewer.timeline.zoomTo(startTime, stopTime)

        // Pre-sample terrain heights for the route to avoid per-frame height flicker
        // Build safe cartographics array (filter invalid points)
        const cartographics = trackPoints
          .map(p => {
            const lon = Number(p.lon)
            const lat = Number(p.lat)
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
            return Cesium.Cartographic.fromDegrees(lon, lat)
          })
          .filter(Boolean) as Cesium.Cartographic[]

        let sampled: Cesium.Cartographic[] | null = null
        try {
          sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
        } catch (sampleErr) {
          console.warn('Could not sample terrain, proceeding without sampled heights:', sampleErr)
          sampled = null
        }

        // Build position property with smoother interpolation (guard against missing sampled data)
        const hikerPositions = new Cesium.SampledPositionProperty()
        for (let i = 0; i < trackPoints.length; i++) {
          try {
            const t = Cesium.JulianDate.fromIso8601(trackPoints[i].time)
            // Prefer sampled cartographic if available, otherwise use raw degrees with 0 height
            let pos: Cesium.Cartesian3 | null = null
            if (sampled && sampled[i]) {
              const c = sampled[i]
              if (c && Number.isFinite(c.longitude) && Number.isFinite(c.latitude)) {
                pos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0)
              }
            }
            if (!pos) {
              // Fallback: create from original GPX point
              const lon = Number(trackPoints[i].lon)
              const lat = Number(trackPoints[i].lat)
              if (Number.isFinite(lon) && Number.isFinite(lat)) {
                pos = Cesium.Cartesian3.fromDegrees(lon, lat, trackPoints[i].ele || 0)
              }
            }

            if (pos) {
              hikerPositions.addSample(t, pos)
            } else {
              console.warn('Skipping invalid position sample at index', i, trackPoints[i])
            }
          } catch (e) {
            console.warn('Error adding hiker position sample:', e)
          }
        }
        // Use Hermite interpolation for smoother curves
        hikerPositions.setInterpolationOptions({
          interpolationAlgorithm: Cesium.HermitePolynomialApproximation,
          interpolationDegree: 2 // Increased degree for smoother curves
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
            text: 'Mikael Norhairovich',
            font: '14pt sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        })

        // Camera animation states
        let isIntroComplete = false
        let isOutroStarted = false
        const INTRO_DURATION = 5 // 5 seconds intro for smoother animation
        const OUTRO_DURATION = 4 // 4 seconds outro
        const OUTRO_START_OFFSET = 6 // Start outro 6 seconds before end

  // Manual camera tracking base values (used to compute a dynamic, terrain-relative offset)
  const CAMERA_BASE_BACK = 2400 // base meters behind the hiker
  const CAMERA_BASE_HEIGHT = 1200 // base meters above the hiker

  // Smoothing for dynamic camera offset to avoid jitter when terrain heights change
  const CAMERA_SMOOTH_ALPHA = 0.15 // EMA alpha: 0 = no update, 1 = instant update
  let smoothedBack = CAMERA_BASE_BACK
  let smoothedHeight = CAMERA_BASE_HEIGHT

        // Position camera at starting position but don't start intro yet
        const startingPosition = hikerEntity.position?.getValue(startTime)
        if (startingPosition && viewer) {
          const startingCartographic = Cesium.Cartographic.fromCartesian(startingPosition)

          // Position camera at a lower, angled view to emphasize 3D perspective
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
              startingCartographic.longitude,
              startingCartographic.latitude,
              30000 // 30km high - angled overview for stronger 3D feel
            ),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-30), // Angled toward horizon for better 3D perception
              roll: 0
            }
          })
          console.log('✓ Camera positioned at start (angled overview)')
        }

        viewer.scene.postRender.addEventListener(() => {
          try {
            // If the animation was marked finished in preRender, then the next postRender
            // indicates the final frame has actually been painted. Signal post-render
            // completion so recorder can stop after the final visual frame is ready.
            try {
              const finished = (window as any).CESIUM_ANIMATION_FINISHED === true
              const postRendered = (window as any).CESIUM_ANIMATION_POST_RENDERED === true
              if (finished && !postRendered) {
                ;(window as any).CESIUM_ANIMATION_POST_RENDERED = true
                console.log('✅ Animation post-rendered (final frame painted)')
              }
            } catch (e) {
              // ignore
            }
            if (!viewer || !hikerEntity || !hikerEntity.position) return

            const currentTime = viewer.clock.currentTime

            // Outro animation removed in headless/recording mode — keep playback stable until the end

            // Exit early if intro not complete
            if (!isIntroComplete) return

            // Get position for tracking (only when intro complete and outro not started)
            const position = hikerEntity.position.getValue(currentTime)
            if (!position) return

            // Validate position object
            if (!position.x && position.x !== 0) return

            // Calculate camera position relative to hiker using a terrain-relative offset
            const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position)

            // Determine terrain height at current position (may be undefined if not available yet)
            let terrainHeight = 0
            try {
              const cart = Cesium.Cartographic.fromCartesian(position)
              const h = viewer.scene.globe.getHeight(cart)
              if (typeof h === 'number' && Number.isFinite(h)) terrainHeight = h
            } catch (e) {
              // ignore
            }

            // Compute dynamic offset: keep minimum safe height but scale up when terrain is high
            const dynamicHeight = Math.max(CAMERA_BASE_HEIGHT, terrainHeight * 0.2 + 800)
            const dynamicBack = Math.max(1200, Math.min(8000, CAMERA_BASE_BACK + terrainHeight * 0.05))

            // Apply exponential smoothing (EMA) to reduce jitter when terrain heights change rapidly
            smoothedBack = smoothedBack * (1 - CAMERA_SMOOTH_ALPHA) + dynamicBack * CAMERA_SMOOTH_ALPHA
            smoothedHeight = smoothedHeight * (1 - CAMERA_SMOOTH_ALPHA) + dynamicHeight * CAMERA_SMOOTH_ALPHA

            const cameraOffsetLocal = new Cesium.Cartesian3(-smoothedBack, 0, smoothedHeight)
            const cameraPosition = Cesium.Matrix4.multiplyByPoint(transform, cameraOffsetLocal, new Cesium.Cartesian3())

              // Point camera at hiker from offset position
            try {
              viewer.camera.position = cameraPosition
              // Use safe lookAt: ensure position is defined
              if (position) viewer.camera.lookAt(position, new Cesium.Cartesian3(0, 0, Math.max(800, dynamicHeight * 0.5))) // Look at hiker, more horizon tilt
            } catch (camErr) {
              console.warn('Camera update failed, skipping this frame:', camErr)
            }
          } catch (outerErr) {
            // Catch any Cesium DeveloperErrors or unexpected runtime errors to avoid stopping the render loop
            console.error('Error in postRender handler (ignored):', outerErr)
            // Optionally set a flag for diagnostics
            ;(window as any).CESIUM_RENDER_ERROR = true
            // If this is a DeveloperError from Cesium, disable camera tracking to avoid repeated failures
            try {
              const msg = outerErr && ((outerErr as any).message || String(outerErr))
              if (msg && msg.toLowerCase().includes('developererror')) {
                console.warn('Detected DeveloperError in render loop — disabling camera tracking for stability')
                if (viewer) viewer.trackedEntity = undefined
                // Dump diagnostics to logs for investigation
                try { (window as any).CESIUM_DUMP && (window as any).CESIUM_DUMP('postRender DeveloperError', outerErr) } catch (e) {}
              }
            } catch (e) {
              // ignore
            }
          }
        })

        // Enable smooth camera movement
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false
        viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.9 // Smooth panning
        viewer.scene.screenSpaceCameraController.inertiaSpin = 0.9 // Smooth rotation
        viewer.scene.screenSpaceCameraController.inertiaZoom = 0.8 // Smooth zoom

        console.log('Camera tracking set to follow hiker at 2400m distance')

        // Create the full route polyline (shows planned path)
        // Create the full route polyline (shows planned path) - filter invalid points first
        const fullRoutePositions = trackPoints
          .map(point => {
            const lon = Number(point.lon)
            const lat = Number(point.lat)
            const ele = Number(point.ele) || 0
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
            return Cesium.Cartesian3.fromDegrees(lon, lat, ele)
          })
          .filter(Boolean) as Cesium.Cartesian3[]

        if (fullRoutePositions.length > 1) {
          viewer.entities.add({
            polyline: {
              positions: fullRoutePositions,
              width: 3,
              material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.WHITE.withAlpha(0.5),
                outlineWidth: 1,
                outlineColor: Cesium.Color.BLUE.withAlpha(0.3)
              }),
              clampToGround: true
            }
          })
          console.log('Full route polyline added')
        } else {
          console.warn('Not enough valid points to draw full route polyline')
        }

        console.log('Full route polyline added')

        // Create a dynamic trail that follows the hiker
        const trailPositions: Cesium.Cartesian3[] = []

        // Use CallbackProperty for dynamic updates without flickering
        const trailEntity = viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => trailPositions, false),
            width: 5,
            material: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW),
            depthFailMaterial: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW),
            clampToGround: true,
            show: true
          }
        })

        console.log('Trail entity created')

        // Update trail positions on each frame using the hiker's stable position
        let lastAddedTime = Cesium.JulianDate.clone(startTime)
        const ADD_INTERVAL_SECONDS = 0.5 // Reduced frequency for better performance
        const MAX_TRAIL_POINTS = 500 // Limit trail length to prevent performance issues

        viewer.scene.preRender.addEventListener(() => {
          try {
            if (!viewer || !hikerEntity || !hikerEntity.position) return
            const currentTime = viewer.clock.currentTime

            // If the clock has reached or passed the stopTime, mark animation finished
            try {
              if (Cesium.JulianDate.compare(currentTime, stopTime) >= 0) {
                if (!(window as any).CESIUM_ANIMATION_FINISHED) {
                  ;(window as any).CESIUM_ANIMATION_FINISHED = true
                  console.log('✅ Animation finished (clock reached stopTime)')
                }
              }
            } catch (e) {
              // ignore
            }

            // Reset trail when animation loops back to start
            if (Cesium.JulianDate.compare(currentTime, lastAddedTime) < 0) {
              console.log('Animation looped, resetting trail')
              trailPositions.length = 0
              lastAddedTime = Cesium.JulianDate.clone(startTime)
              return
            }

            const currentPosition = hikerEntity.position.getValue(currentTime)
            if (!currentPosition) return

            const dt = Cesium.JulianDate.secondsDifference(currentTime, lastAddedTime)
            if (dt < ADD_INTERVAL_SECONDS && trailPositions.length > 0) return

            // Use the entity's current position (already height-stable via pre-sampled data)
            try {
              trailPositions.push(currentPosition.clone())
            } catch (e) {
              console.warn('Failed to clone currentPosition for trail, skipping point:', e)
            }

            // Keep a small snapshot of recent trail positions for diagnostics
            try {
              const snap = trailPositions.slice(-20).map(p => {
                try {
                  const c = Cesium.Cartographic.fromCartesian(p)
                  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), h: c.height }
                } catch (e) { return { error: true } }
              })
              ;(window as any).__lastTrailSnapshot = snap
            } catch (e) {
              // ignore
            }

            // Limit trail length by removing old points (keep most recent trail)
            if (trailPositions.length > MAX_TRAIL_POINTS) {
              trailPositions.shift() // Remove oldest point
            }

            lastAddedTime = Cesium.JulianDate.clone(currentTime)
          } catch (err) {
            console.error('Error in preRender handler (ignored):', err)
            ;(window as any).CESIUM_RENDER_ERROR = true
          }
        })

  console.log('✓ Route loaded and animation started! (intro/outro disabled)')
        console.log('✓ Animation clock:', {
          startTime: Cesium.JulianDate.toIso8601(viewer.clock.startTime),
          stopTime: Cesium.JulianDate.toIso8601(viewer.clock.stopTime),
          multiplier: viewer.clock.multiplier
        })
        // Verify tracking is still active after trail setup
  (globalThis as any).setTimeout(() => {
          if (viewer && viewer.trackedEntity === hikerEntity) {
            console.log('✓ Camera tracking confirmed active')
            const pos = viewer.camera.positionCartographic
            console.log('✓ Current camera:', {
              lat: Cesium.Math.toDegrees(pos.latitude),
              lon: Cesium.Math.toDegrees(pos.longitude),
              height: pos.height
            })
          } else {
            console.warn('⚠️ Camera tracking was disabled, re-enabling')
            if (viewer) viewer.trackedEntity = hikerEntity
          }
        }, 1000)

        // Wait for globe tiles to visually finish loading before signaling readiness
        // This prevents the recorder from capturing initial solid-blue frames
  (function waitForTilesThenReady() {
          const MAX_WAIT_MS = 30000 // 30s max wait for tiles
          const CHECK_INTERVAL_MS = 500
          let waited = 0

          const check = () => {
            try {
              const tilesLoaded = viewer && viewer.scene && viewer.scene.globe ? viewer.scene.globe.tilesLoaded : false
              console.log('Tile load check:', { tilesLoaded, waited })
              if (tilesLoaded) {
                // Give a short grace period to allow imagery to render
                (globalThis as any).setTimeout(() => {
                  isIntroComplete = true
                  ;(window as any).CESIUM_ANIMATION_READY = true
                  console.log('✅ Animation ready (tiles loaded)')
                }, 1500)
                return
              }

              if (waited >= MAX_WAIT_MS) {
                // Timeout: proceed anyway but warn
                isIntroComplete = true
                ;(window as any).CESIUM_ANIMATION_READY = true
                console.warn('Tiles did not finish loading within timeout; proceeding with recording')
                return
              }

              waited += CHECK_INTERVAL_MS
              (globalThis as any).setTimeout(check, CHECK_INTERVAL_MS)
            } catch (e) {
              // On error, proceed to avoid blocking indefinitely
              isIntroComplete = true
              ;(window as any).CESIUM_ANIMATION_READY = true
              console.error('Error while waiting for tiles; proceeding', e)
            }
          }

          check()
        })()

      } catch (error) {
        console.error('Error initializing Cesium:', error)
      }
  }

    initViewer()

    return () => {
      try {
        // Remove global handlers we added
        try { window.removeEventListener('error', (window as any).__onWindowError) } catch (e) {}
        try { window.removeEventListener('unhandledrejection', (window as any).__onUnhandledRejection) } catch (e) {}
        try { delete (window as any).CESIUM_DUMP } catch (e) {}
        try { delete (window as any).__lastTrailSnapshot } catch (e) {}
      } catch (cleanupErr) {
        console.warn('Error cleaning up global handlers:', cleanupErr)
      }
      if (viewer) {
        console.log('Destroying Cesium viewer')
        viewer.destroy()
      }
    }
  }, [])

  // Toggle menu visibility
  useEffect(() => {
    if (viewerRef.current) {
      const viewer = viewerRef.current
      const animationContainer = viewer.animation?.container as HTMLElement
      const timelineContainer = viewer.timeline?.container as HTMLElement

      if (animationContainer) {
        animationContainer.style.display = menuVisible ? 'block' : 'none'
      }
      if (timelineContainer) {
        timelineContainer.style.display = menuVisible ? 'block' : 'none'
      }
    }
  }, [menuVisible])

  const toggleMenu = () => {
    setMenuVisible(!menuVisible)
  }

  const handleRouteChange = (route: string) => {
    // Reload page with new route
    window.location.href = `?gpx=${encodeURIComponent(route)}`
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // Upload to API server if available, or handle locally
      const formData = new FormData()
      formData.append('gpx', file)

      // For now, just show a message
      alert(`File upload to API server not yet configured. File: ${file.name}`)
    } catch (error) {
      console.error('Error uploading file:', error)
      alert('Error uploading file')
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} className="cesium-container" style={{ width: '100%', height: '100%' }} />

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
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentRoute !== route) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
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
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.5)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 139, 34, 0.3)'
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
  )
}
