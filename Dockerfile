FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm ci
COPY . .
RUN npm run build

FROM node:20

WORKDIR /app

# Install Google Chrome (stable), FFmpeg, and Xvfb
# Note: Using Google Chrome instead of Debian Chromium package due to crash handler issues
# Debian Chromium 142+ has crashpad compatibility problems
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ffmpeg \
    xvfb \
    xauth \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libglu1-mesa \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i google-chrome-stable_current_amd64.deb || apt-get -fy install \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Copy built app
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Set Puppeteer environment variables BEFORE npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV HOME=/tmp

# Install minimal HTTP server and recording dependencies
RUN npm install --no-save puppeteer@19.0.0 serve-handler

# Copy recording scripts
COPY docker/record-puppeteer.js ./
COPY docker/record-ffmpeg.js ./
COPY docker/record-cdp.js ./
COPY docker/record-canvas.js ./
COPY docker/run-with-xvfb.sh ./
RUN chmod +x run-with-xvfb.sh

# Create output directory
RUN mkdir -p /app/output && chmod 777 /app/output

CMD ["./run-with-xvfb.sh"]
