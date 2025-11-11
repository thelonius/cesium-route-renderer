import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Get git commit hash for version tracking
const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
};

// Vite config tuned for Cesium static assets and relative asset handling
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
      // deep import workaround for @zip.js package which doesn't export some internal paths
      ,
      '@zip.js/zip.js/lib/zip-no-worker.js': path.resolve(__dirname, 'node_modules', '@zip.js', 'zip.js', 'lib', 'zip-no-worker.js')
    }
  },
  define: {
    // Make Cesium use the public/cesium base URL at runtime
    'CESIUM_BASE_URL': JSON.stringify('/cesium/'),
    // Add version info
    '__APP_VERSION__': JSON.stringify(getGitHash())
  },
  optimizeDeps: {
    // Do not attempt to pre-bundle Cesium (workers/WASM cause MIME/type issues)
    exclude: ['cesium'],
    // Pre-bundle CommonJS dependencies that Cesium uses
    include: [
      'mersenne-twister',
      'urijs',
      'earcut',
      'pako',
      'rbush',
      'kdbush',
      'grapheme-splitter',
      'bitmap-sdf',
      'lerc',
      'nosleep.js'
    ]
  },
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        // keep assetFileNames stable for Cesium
        assetFileNames: (chunkInfo) => {
          return chunkInfo.name && chunkInfo.name.includes('cesium')
            ? 'assets/cesium/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})
