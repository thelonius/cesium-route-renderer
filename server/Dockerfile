FROM node:20

WORKDIR /app

# Install Docker CLI to run containers
RUN apt-get update && apt-get install -y \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy server code
COPY index.js ./

# Create directories
RUN mkdir -p output uploads

EXPOSE 3000

CMD ["node", "index.js"]
