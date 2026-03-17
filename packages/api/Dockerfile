# Railway Dockerfile for Forj API (Monorepo)
# Build context should be set to monorepo root (../../ from service directory)

FROM node:18-slim

WORKDIR /app

# Copy root package files and all workspace packages
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/api/package*.json ./packages/api/

# Install all dependencies (understands workspaces)
RUN npm install

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

# Build shared package first, then API
RUN npm run build -w packages/shared
RUN npm run build -w packages/api

# Set environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Start API server
CMD ["npm", "run", "start", "-w", "packages/api"]
