# =============================================================================
# Securities Law Schema - Production Dockerfile
# =============================================================================
# Multi-stage build for security and minimal image size
# Follows CIS Docker Benchmark recommendations
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:18-alpine AS deps

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Run validation
RUN npm run validate

# Run tests - fail build if tests fail
RUN npm run test:unit

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:18-alpine AS production

# Security: Don't run as root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S compliance -u 1001 -G nodejs

WORKDIR /app

# Copy production dependencies
COPY --from=deps --chown=compliance:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=compliance:nodejs package.json ./
COPY --chown=compliance:nodejs src ./src
COPY --chown=compliance:nodejs schemas ./schemas
COPY --chown=compliance:nodejs controls ./controls
COPY --chown=compliance:nodejs contexts ./contexts
COPY --chown=compliance:nodejs config ./config
COPY --chown=compliance:nodejs scripts ./scripts

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Security headers
ENV npm_config_audit=false

# Switch to non-root user
USER compliance

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/v1/health || exit 1

# Start application (with auto-migration and optional seeding)
CMD ["node", "scripts/start-server.js"]
