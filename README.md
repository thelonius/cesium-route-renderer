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
