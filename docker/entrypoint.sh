#!/bin/sh
# Container Image Compare - Docker Entrypoint Script
#
# This script runs on container startup to perform initialization tasks
# before starting the main Node.js application.
#
# ============================================================================
# Podman State Cleanup
# ============================================================================
# Podman stores boot IDs and runtime state that become invalid when the
# container restarts. This causes "boot ID differs from cached boot ID" errors.
# We also clean Podman image storage on startup to prevent bloat from
# orphaned images accumulating across restarts.
# ============================================================================

echo "Container Image Compare - Starting up..."

# Clean up Podman runtime state directories if they exist
# This prevents "boot ID differs from cached boot ID" errors
if [ -d "/app/appdata/podman/run" ]; then
  echo "Cleaning Podman runtime state..."
  rm -rf /app/appdata/podman/run/*
fi

if [ -d "/run/libpod" ]; then
  echo "Cleaning libpod runtime state..."
  rm -rf /run/libpod/*
fi

# Clean Podman image storage on startup to prevent storage bloat
# Images will be re-loaded on demand when the terminal feature is used
if [ -d "/app/appdata/podman/storage" ]; then
  echo "Cleaning Podman image storage to prevent storage bloat..."
  rm -rf /app/appdata/podman/storage/*
fi

# Recreate the run and storage directories with correct structure
mkdir -p /app/appdata/podman/run
mkdir -p /app/appdata/podman/storage

echo "Initialization complete"
echo "Starting Node.js server..."

# Start the Node.js application
exec node dist/backend/src/server.js
