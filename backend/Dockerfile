# Backend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm install --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Note: Environment variables should be passed via docker-compose or -e flags
# The .env.production file is NOT copied into the image for security
# All env vars are provided at runtime via docker-compose.yml

# Create uploads directory
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

EXPOSE 5050

# Set NODE_ENV to production for Docker builds
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
