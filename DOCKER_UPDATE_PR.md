# Docker Base Image Update: node:20 → node:20-alpine

## Summary
Updated both Dockerfiles (`Dockerfile` and `server/Dockerfile`) to use the Alpine variant of the Node.js 20 base image for smaller image sizes and faster deployments.

## Changes

### Main Application Dockerfile (`Dockerfile`)
- **Base image:** `node:20` → `node:20-alpine`
- **Package manager:** `apt-get` → `apk`
- **Packages updated:**
  - Chromium, FFmpeg, Xvfb, mesa/GL packages adapted to Alpine package names
  - Used `xvfb-run`, `mesa-dri-gallium`, `mesa-gl`, `glu` for Alpine compatibility

### Server Dockerfile (`server/Dockerfile`)
- **Base image:** `node:20` → `node:20-alpine`
- **Package manager:** `apt-get` → `apk`
- **Packages:** `docker.io` → `docker-cli` (Alpine package name)
- **Build fixes:**
  - Added `COPY ../scripts ./scripts` before `npm ci` to ensure postinstall script (`copy-cesium-assets.js`) runs successfully
  - Fixed COPY paths for server code: `server/index.js`, `server/services`, `server/cleanup-old-renders.js`, `config`

## Build Verification
Both images built successfully locally:
- **Server image:** `docker build -f server/Dockerfile -t cesium-server:test .` ✅
- **Frontend image:** `docker build -f Dockerfile -t cesium-frontend:test .` ✅

## Benefits
- **Smaller image size:** Alpine base images are typically ~40% smaller than Debian-based images
- **Faster CI/CD:** Reduced pull and push times
- **Security:** Smaller attack surface with minimal Alpine base

## Testing Recommendations
1. Deploy to staging environment
2. Verify Chromium/Puppeteer recording functionality
3. Confirm FFmpeg video encoding works correctly
4. Test server API endpoints (`/render-route`, `/status/:id`, `/logs/:id`)
5. Check cleanup cron job (`cleanup-old-renders.js`)

## Deployment Notes
- No environment variable changes required
- Existing volumes and network configs remain compatible
- Puppeteer already configured to use system Chromium (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`)

## Rollback Plan
If issues arise, revert to previous commit:
```bash
git revert 08a4bbc
git push origin update/docker-version
```

## Related Issues
- Addresses deployment optimization for bot infrastructure
- Reduces container registry storage costs
