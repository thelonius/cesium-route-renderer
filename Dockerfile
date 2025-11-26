FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm install
COPY . .
RUN npm run build

FROM node:20

WORKDIR /app

# Install Chromium, FFmpeg, and Xvfb for virtual display
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    xvfb \
    xauth \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

# Copy built app
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/config ./config

# Set Puppeteer environment variables before installing
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install minimal HTTP server and recording dependencies
RUN npm install --no-save puppeteer@19.0.0 puppeteer-screen-recorder@3.0.6 serve-handler

# Copy recording scripts
COPY docker/record-puppeteer.js ./
COPY docker/run-with-xvfb.sh ./
RUN chmod +x run-with-xvfb.sh

# Create output directory with proper permissions for any user
RUN mkdir -p /app/output && chmod 777 /app/output

CMD ["./run-with-xvfb.sh"]
