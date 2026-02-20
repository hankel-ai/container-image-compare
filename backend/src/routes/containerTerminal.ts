/**
 * Container Terminal API Routes
 * 
 * ============================================================================
 * IMPORTANT: Docker/Podman Runtime Dependency Notice
 * ============================================================================
 * 
 * These routes provide the API for the interactive container terminal feature.
 * This feature requires Docker or Podman to be installed on the host system.
 * 
 * NO OTHER routes or features in this application require Docker or Podman.
 * If no container runtime is detected, these endpoints will return appropriate
 * error responses, but all other API routes continue to work normally.
 * 
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { containerTerminalService } from '../services/containerTerminal';
import { ImageCacheServiceOCI } from '../services/imageCacheOCI';
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('ContainerTerminalRoutes');

/**
 * Image cache service instance
 * Used ONLY to retrieve cached image tar paths for terminal sessions
 */
const imageCacheService = new ImageCacheServiceOCI();

/**
 * GET /api/container-terminal/status
 * 
 * Check if the container terminal feature is available.
 * Returns information about the detected container runtime.
 * 
 * This endpoint is used by the frontend to determine whether to show
 * or hide the terminal feature in the UI.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const runtime = containerTerminalService.getRuntime();
    
    res.json({
      available: runtime.available,
      runtime: runtime.type,
      version: runtime.version,
      message: runtime.available 
        ? `${runtime.type === 'docker' ? 'Docker' : 'Podman'} ${runtime.version} detected`
        : 'No container runtime detected. Install Docker or Podman to enable the terminal feature.'
    });
  } catch (error: any) {
    logger.error('Failed to get terminal status', { error: error.message });
    res.status(500).json({
      available: false,
      runtime: 'none',
      version: null,
      message: 'Failed to detect container runtime',
      error: error.message
    });
  }
});

/**
 * POST /api/container-terminal/create
 * 
 * Create a new container terminal session for a cached image.
 * 
 * Request body:
 * - imageRef: The image reference (e.g., "nginx:latest")
 * - workingDir: Initial working directory (optional, only include if explicitly specified from Filesystem tab)
 * 
 * Returns session information including the session ID for WebSocket connection.
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { imageRef, workingDir } = req.body;

    if (!imageRef) {
      return res.status(400).json({
        error: 'Missing required parameter: imageRef'
      });
    }

    // Check if runtime is available
    if (!containerTerminalService.isAvailable()) {
      return res.status(503).json({
        error: 'Container terminal feature is not available',
        message: 'No container runtime detected. Install Docker or Podman to use this feature.',
        available: false
      });
    }

    // Get the cached image data
    const cachedImage = await imageCacheService.getCachedImage(imageRef);
    if (!cachedImage) {
      // Check if the image is currently being downloaded
      if (imageCacheService.isDownloadInProgress(imageRef)) {
        // Return a special status indicating the client should retry
        return res.status(202).json({
          error: 'Image download in progress',
          message: `The image "${imageRef}" is currently being downloaded. Please wait...`,
          retry: true,
          retryAfterMs: 2000
        });
      }
      return res.status(404).json({
        error: 'Image not found in cache',
        message: `The image "${imageRef}" is not cached. Please download it first.`
      });
    }

    // Check if image was already prepared by background process
    // If so, we can skip the getDockerImageTarPath step entirely
    let dockerImageTarPath: string | null = null;
    let usePodmanPull = false;
    let preparedImage = containerTerminalService.getPreparedImage(imageRef);
    
    // Get cache directory from tarPath for constructing local tag
    const path = require('path');
    const cacheDir = path.dirname(cachedImage.tarPath);
    const cacheFolderName = path.basename(cacheDir);
    
    // If image is currently being prepared (podman import in progress), wait for it
    if (!preparedImage && containerTerminalService.isImageBeingPrepared(imageRef)) {
      logger.info(`Image preparation in progress, waiting...`, { imageRef });
      const ready = await containerTerminalService.waitForImagePreparation(imageRef, 120000);
      if (ready) {
        preparedImage = containerTerminalService.getPreparedImage(imageRef);
      }
    }
    
    if (preparedImage) {
      logger.info(`Using pre-prepared image for ${imageRef}`, { localTag: preparedImage.localTag });
      // Image is already loaded in podman/docker, no tar needed
      dockerImageTarPath = null;
    } else {
      // Get or create the Docker-compatible image tar (Option A - full image fidelity)
      // This creates a proper OCI image archive that can be loaded with `docker load`
      logger.info(`Preparing Docker-compatible image for ${imageRef}`);
      try {
        dockerImageTarPath = await imageCacheService.getDockerImageTarPath(imageRef);
      } catch (err: any) {
        // If layers not available, fall back to checking if image exists in podman
        if (err.message.includes('Original layers not available')) {
          logger.info(`Layers not available for ${imageRef}, checking if image exists in container runtime`);
          usePodmanPull = true;
        } else {
          logger.error(`Could not create Docker image tar: ${err.message}`);
          return res.status(400).json({
            error: 'Failed to prepare image for terminal',
            message: err.message
          });
        }
      }
    }

    // Create the session
    // If dockerImageTarPath is null, createSession will use the pre-prepared image
    // If usePodmanPull is true, createSession will check for existing image or pull
    const session = await containerTerminalService.createSession(
      imageRef,
      dockerImageTarPath || '',
      workingDir,
      usePodmanPull,
      cacheFolderName
    );

    logger.info(`Created terminal session ${session.id} for ${imageRef}`);

    res.json({
      sessionId: session.id,
      imageRef: session.imageRef,
      status: session.status,
      workingDir: session.workingDir,
      runtime: session.runtime,
      createdAt: session.createdAt.toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to create terminal session', { error: error.message });
    res.status(500).json({
      error: 'Failed to create terminal session',
      message: error.message
    });
  }
});

/**
 * GET /api/container-terminal/sessions
 * 
 * List all active terminal sessions.
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = containerTerminalService.getAllSessions();
    
    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.id,
        imageRef: s.imageRef,
        status: s.status,
        workingDir: s.workingDir,
        runtime: s.runtime,
        createdAt: s.createdAt.toISOString(),
        containerId: s.containerId
      }))
    });
  } catch (error: any) {
    logger.error('Failed to list sessions', { error: error.message });
    res.status(500).json({
      error: 'Failed to list sessions',
      message: error.message
    });
  }
});

/**
 * GET /api/container-terminal/session/:sessionId
 * 
 * Get information about a specific session.
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = containerTerminalService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No session found with ID: ${sessionId}`
      });
    }

    res.json({
      sessionId: session.id,
      imageRef: session.imageRef,
      status: session.status,
      workingDir: session.workingDir,
      runtime: session.runtime,
      createdAt: session.createdAt.toISOString(),
      containerId: session.containerId,
      error: session.error
    });
  } catch (error: any) {
    logger.error('Failed to get session', { error: error.message, sessionId: req.params.sessionId });
    res.status(500).json({
      error: 'Failed to get session',
      message: error.message
    });
  }
});

/**
 * DELETE /api/container-terminal/session/:sessionId
 * 
 * Terminate a container terminal session.
 * Called when user navigates away from the terminal or closes the browser.
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    await containerTerminalService.terminateSession(sessionId);

    logger.info(`Terminated terminal session ${sessionId}`);

    res.json({
      success: true,
      message: `Session ${sessionId} terminated`
    });
  } catch (error: any) {
    logger.error('Failed to terminate session', { error: error.message, sessionId: req.params.sessionId });
    res.status(500).json({
      error: 'Failed to terminate session',
      message: error.message
    });
  }
});

/**
 * POST /api/container-terminal/session/:sessionId/resize
 * 
 * Resize the terminal PTY for a session.
 */
router.post('/session/:sessionId/resize', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { cols, rows } = req.body;

    if (!cols || !rows) {
      return res.status(400).json({
        error: 'Missing required parameters: cols and rows'
      });
    }

    await containerTerminalService.resizeTerminal(sessionId, cols, rows);

    res.json({
      success: true
    });
  } catch (error: any) {
    logger.error('Failed to resize terminal', { error: error.message, sessionId: req.params.sessionId });
    res.status(500).json({
      error: 'Failed to resize terminal',
      message: error.message
    });
  }
});

export default router;
