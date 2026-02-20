# Container Image Compare - Docker Build
# Multi-stage build for optimized production image
#
# ============================================================================
# CONTAINER RUNTIME DEPENDENCY NOTICE
# ============================================================================
#
# This Docker image includes Podman for the interactive terminal feature.
# Podman is bundled instead of Docker to avoid running a Docker daemon
# inside the container (Docker-in-Docker requires privileged mode).
#
# The terminal feature allows users to run a shell inside downloaded images.
# NO OTHER functionality in this app requires Podman - the core features
# (image comparison, filesystem browsing) work independently.
#
# If you don't need the terminal feature, Podman can be removed from this
# Dockerfile to reduce image size.
#
# ============================================================================

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
#If required
#ARG HTTP_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"
#ARG HTTPS_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./
COPY shared/ ../shared/

# Build frontend
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-builder
#If required
#ARG HTTP_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"
#ARG HTTPS_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"

WORKDIR /app/backend

# Install Python and build tools for node-pty native module compilation
RUN apk add --no-cache python3 make g++ linux-headers

# Copy backend package files
COPY backend/package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy backend source and shared types
COPY backend/ ./
COPY shared/ ../shared/

# Build TypeScript
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS production
#If required
#ARG HTTP_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"
#ARG HTTPS_PROXY="http://f5exp-proxy.bp2.otxlab.net:3128"

WORKDIR /app

# Install curl for manual registry testing inside container
# Install podman for the interactive terminal feature
#
# ============================================================================
# PODMAN INSTALLATION NOTE
# ============================================================================
# Podman is installed ONLY for the interactive terminal feature that allows
# users to run a shell inside downloaded container images.
#
# If you don't need terminal functionality, remove the podman installation
# to reduce image size. All other features will continue to work.
# ============================================================================
RUN apk add --no-cache curl podman fuse-overlayfs iptables python3 make g++ linux-headers

# Install production dependencies only (needs build tools for node-pty)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --production

# Remove build tools after node-pty is compiled to reduce image size
RUN apk del python3 make g++ linux-headers

# Copy built backend
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy shared types (needed at runtime for type references)
COPY shared/ ./shared/

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create appdata directory
RUN mkdir -p /app/appdata/cache /app/appdata/history /app/appdata/logs /app/appdata/temp

# Configure Podman storage for operation inside Kubernetes
# This is required ONLY for the terminal feature
# Using overlay driver with fuse-overlayfs for efficient layer sharing
# (fuse-overlayfs avoids VFS which duplicates every layer and wastes massive storage)
RUN mkdir -p /etc/containers && \
    echo '[storage]' > /etc/containers/storage.conf && \
    echo 'driver = "overlay"' >> /etc/containers/storage.conf && \
    echo 'graphroot = "/app/appdata/podman/storage"' >> /etc/containers/storage.conf && \
    echo 'runroot = "/app/appdata/podman/run"' >> /etc/containers/storage.conf && \
    echo '' >> /etc/containers/storage.conf && \
    echo '[storage.options.overlay]' >> /etc/containers/storage.conf && \
    echo 'mount_program = "/usr/bin/fuse-overlayfs"' >> /etc/containers/storage.conf && \
    mkdir -p /app/appdata/podman/storage /app/appdata/podman/run

# Configure Podman to run without user namespaces (rootful mode)
# This is needed when running inside a container, even with privileged mode
RUN mkdir -p /etc/containers && \
    echo '[containers]' > /etc/containers/containers.conf && \
    echo 'netns = "host"' >> /etc/containers/containers.conf && \
    echo 'userns = "host"' >> /etc/containers/containers.conf && \
    echo 'ipcns = "host"' >> /etc/containers/containers.conf && \
    echo 'utsns = "host"' >> /etc/containers/containers.conf && \
    echo 'cgroupns = "host"' >> /etc/containers/containers.conf && \
    echo '[engine]' >> /etc/containers/containers.conf && \
    echo 'cgroup_manager = "cgroupfs"' >> /etc/containers/containers.conf && \
    echo 'events_logger = "file"' >> /etc/containers/containers.conf

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV APP_DATA_DIR=/app/appdata
# Disable Podman's rootless mode - we're running as root in privileged container
ENV _CONTAINERS_USERNS_CONFIGURED=""
ENV BUILDAH_ISOLATION=chroot

# Expose port
EXPOSE 5000

# NOTE: Running as root for Podman compatibility in Kubernetes
# Rootless Podman requires user namespace support which most K8s clusters don't provide
# If you don't need the terminal feature, you can add "USER node" here for better security

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start server with entrypoint script that cleans Podman state
WORKDIR /app/backend
ENTRYPOINT ["/app/entrypoint.sh"]
