# Cesium Vite React

Minimal Vite + React + TypeScript starter that integrates CesiumJS.

Getting started

1. Install dependencies

```bash
npm install
```

2. Start dev server

```bash
npm run dev
```

Notes

- The `postinstall` script attempts to copy Cesium's static build assets into `public/cesium` so Cesium can load workers and static assets from `/cesium/` at runtime. If the script fails, run `node scripts/copy-cesium-assets.js` after install.
- On macOS you may need to allow npm to create files in the project folder if permissions are restricted.

Recording / Runtime environment variables
--------------------------------------

The recorder and server support several environment variables you can use to tune recordings or run in a headless-friendly mode.

- HEADLESS=1
	- When set inside the container (the API now passes this automatically), the recorder will prefer stable, lower-quality defaults (30 fps, 720x1280) to improve reliability in headless/container environments.

- RECORD_FPS, RECORD_WIDTH, RECORD_HEIGHT
	- Explicitly override the recorder's target FPS and resolution. These take precedence over HEADLESS defaults.
	- Example: `RECORD_FPS=60 RECORD_WIDTH=1080 RECORD_HEIGHT=1920`

- GPX_FILENAME
	- Filename of the GPX that the recorder should load (the API sets this when launching Docker).

- ANIMATION_SPEED
	- Controls the route playback speed multiplier inside the recorder (default set by the API to 100).

Examples
```
# Run the container with headless-friendly defaults (what the API does):
docker run --rm -e HEADLESS=1 -e GPX_FILENAME=virages.gpx -v /host/output:/output cesium-route-recorder

# Force high-quality 60fps 1080x1920 recording even in headless mode:
docker run --rm -e HEADLESS=1 -e RECORD_FPS=60 -e RECORD_WIDTH=1080 -e RECORD_HEIGHT=1920 -e GPX_FILENAME=virages.gpx -v /host/output:/output cesium-route-recorder
```
