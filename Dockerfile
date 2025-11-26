FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Install Chromium, FFmpeg, and Xvfb for virtual display (alpine)
RUN apk add --no-cache \
    chromium \
    ffmpeg \
    xvfb-run \
    xauth \
    mesa-dri-gallium \
    mesa-gl \
    glu \
    bash

# Copy built app
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/config ./config

# Install minimal HTTP server and recording dependencies
RUN npm install --no-save puppeteer@19.0.0 serve-handler

# Copy recording scripts
COPY docker/record-puppeteer.js ./
COPY docker/record-ffmpeg.js ./
COPY docker/record-cdp.js ./
COPY docker/record-canvas.js ./
COPY docker/run-with-xvfb.sh ./
RUN chmod +x run-with-xvfb.sh

# Create output directory with proper permissions for any user
RUN mkdir -p /app/output && chmod 777 /app/output

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["sh", "-c", "./run-with-xvfb.sh"]
