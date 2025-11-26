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
    ffmpeg \
    xvfb \
    xauth \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome (stable, official build) instead of Chromium
# Chrome handles crashpad better and works more reliably with Puppeteer
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

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
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

CMD ["./run-with-xvfb.sh"]
