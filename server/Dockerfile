FROM node:20

WORKDIR /app

RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

# Copy package files and required scripts for postinstall
COPY package*.json ./
COPY ../scripts ./scripts
RUN npm ci --production

# Copy server code
COPY server/index.js ./
COPY server/services ./services
COPY server/cleanup-old-renders.js ./cleanup-old-renders.js
COPY config ./config

# Create directories
RUN mkdir -p output uploads

EXPOSE 3000

CMD ["node", "index.js"]
