import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ImageCacheServiceOCI } from '../services/imageCacheOCI';
import { ComparisonService } from '../services/comparison';
import { HistoryService } from '../services/history';
import { settingsService } from '../services/settings';
import { ComparisonRequest } from '../../../shared/types';
import { createLogger } from '../utils/logger';

const router = Router();
const cacheService = new ImageCacheServiceOCI();
const comparisonService = new ComparisonService();
const historyService = new HistoryService();
const logger = createLogger('Comparison');

settingsService.init();

// Initialize services
cacheService.init();
historyService.init();

// Helper to get registry from image ref
function getRegistryFromImage(imageRef: string): string {
  const parts = imageRef.split(':')[0].split('/');
  if (parts.length > 2 || (parts.length === 2 && parts[0].includes('.'))) {
    return parts[0];
  }
  return 'registry-1.docker.io';
}

// Create a new comparison
router.post('/', async (req, res) => {
  try {
    let { leftImage, rightImage, leftCredentialId, rightCredentialId }: ComparisonRequest = req.body;

    // Trim whitespace from inputs to avoid accidental re-downloads
    leftImage = leftImage?.trim();
    rightImage = rightImage?.trim();

    if (!leftImage || !rightImage) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Both leftImage and rightImage are required'
      });
    }

    const comparisonId = uuidv4();
    
    // Get credentials for each image
    const creds = await settingsService.getCredentials();
    const leftRegistry = getRegistryFromImage(leftImage);
    const rightRegistry = getRegistryFromImage(rightImage);
    
    // Match credentials by hostname - the stored registry may include path (e.g., "host.com/repo")
    // or just hostname, so we check if either starts with or equals the other
    const findCredForRegistry = (registry: string) => {
      return creds.find(c => {
        const storedHost = c.registry.split('/')[0];
        return storedHost === registry || c.registry === registry || c.registry.startsWith(registry + '/');
      });
    };
    
    let leftCred = leftCredentialId ? creds.find(c => c.id === leftCredentialId) : findCredForRegistry(leftRegistry);
    let rightCred = rightCredentialId ? creds.find(c => c.id === rightCredentialId) : findCredForRegistry(rightRegistry);
    
    logger.debug('Credential lookup', { 
      leftRegistry, rightRegistry, 
      leftCredFound: !!leftCred, rightCredFound: !!rightCred,
      availableCreds: creds.map(c => c.registry)
    });

    // Step 1: Fetch digests from both registries first to enable cross-registry comparison
    logger.info('Fetching image digests', { leftImage, rightImage });
    
    let leftDigest: string | null = null;
    let rightDigest: string | null = null;
    
    try {
      const leftInfo = await cacheService.getRemoteImageDigest(
        leftImage, 
        leftCred ? { username: leftCred.username, password: leftCred.password } : undefined
      );
      leftDigest = leftInfo?.configDigest || null;
    } catch (err: any) {
      if (err?.name === 'AuthError') {
        logger.error('Auth failed for left image', { registry: leftRegistry, image: leftImage, credUsed: !!leftCred, error: err.message });
        return res.status(401).json({ 
          error: 'Registry Access Failed', 
          message: err.message || `Authentication failed for: ${leftImage}`, 
          details: { registry: leftRegistry, side: 'left', image: leftImage } 
        });
      }
      throw err;
    }
    
    try {
      const rightInfo = await cacheService.getRemoteImageDigest(
        rightImage, 
        rightCred ? { username: rightCred.username, password: rightCred.password } : undefined
      );
      rightDigest = rightInfo?.configDigest || null;
    } catch (err: any) {
      if (err?.name === 'AuthError') {
        logger.error('Auth failed for right image', { registry: rightRegistry, image: rightImage, credUsed: !!rightCred, error: err.message });
        return res.status(401).json({ 
          error: 'Registry Access Failed', 
          message: err.message || `Authentication failed for: ${rightImage}`, 
          details: { registry: rightRegistry, side: 'right', image: rightImage } 
        });
      }
      throw err;
    }
    
    // Check if images are identical (same digest)
    if (leftDigest && rightDigest && leftDigest === rightDigest) {
      logger.info('Images are identical (same digest)', { digest: leftDigest.slice(0, 20) });
    }

    // Download/cache both images (will use cache if available)
    let leftCached = await cacheService.downloadAndCacheImage(
      leftImage,
      leftCred,
      (progress, status) => {
        logger.progress('left', progress, status);
      }
    );
    
    let rightCached = await cacheService.downloadAndCacheImage(
      rightImage,
      rightCred,
      (progress, status) => {
        logger.progress('right', progress, status);
      }
    );

    // Perform comparison
    const result = comparisonService.compareImages(leftCached, rightCached, comparisonId);

    // Save to history only on successful comparison
    try {
      await historyService.save(result);
    } catch (historyErr) {
      logger.warn('Failed to save to history', { error: historyErr });
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Comparison error', { error: error?.message, stack: error?.stack });
    if (error && error.name === 'AuthError') {
      const details = error.details || {};
      return res.status(401).json({ error: 'Authentication Required', message: error.message, details });
    }
    // Handle SSL/TLS certificate errors with specific message
    if (error?.code === 'SSL_ERROR' || error?.message?.includes('self-signed') || error?.message?.includes('certificate')) {
      return res.status(400).json({
        error: 'SSL Certificate Error',
        message: error.message || 'SSL/TLS certificate verification failed',
        details: { suggestion: 'Enable "Skip TLS Verification" in Settings for self-signed certificates' }
      });
    }
    // Handle network errors (DNS, connection refused, timeout)
    if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('ENOTFOUND') || 
        error?.message?.includes('ECONNREFUSED') || error?.message?.includes('ETIMEDOUT') ||
        error?.message?.includes('ENETUNREACH') || error?.message?.includes('EAI_AGAIN')) {
      return res.status(400).json({
        error: 'Network Error',
        message: error.message || 'Failed to connect to registry',
        details: { suggestion: 'Check that the registry hostname is correct and reachable' }
      });
    }
    res.status(500).json({
      error: 'Comparison Failed',
      message: error.message || 'An error occurred during comparison',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get comparison by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const comparison = await historyService.getById(id);

    if (!comparison) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Comparison with ID ${id} not found`
      });
    }

    res.json(comparison);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Get file content diff
router.post('/file-diff', async (req, res) => {
  try {
    const { comparisonId, filePath } = req.body;

    const comparison = await historyService.getById(comparisonId);
    if (!comparison) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Comparison not found'
      });
    }

    let leftContent = '';
    let rightContent = '';

    try {
      const leftBuffer = await cacheService.getFileContent(
        comparison.leftImage.fullName,
        filePath
      );
      leftContent = leftBuffer.toString('utf-8');
    } catch {
      // File doesn't exist in left image
    }

    try {
      const rightBuffer = await cacheService.getFileContent(
        comparison.rightImage.fullName,
        filePath
      );
      rightContent = rightBuffer.toString('utf-8');
    } catch {
      // File doesn't exist in right image
    }

    const diff = comparisonService.compareFileContent(leftContent, rightContent);

    res.json({
      path: filePath,
      leftContent,
      rightContent,
      diff
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Inspect a single image
router.post('/inspect', async (req, res) => {
  try {
    let { imageRef, credentialId }: { imageRef: string; credentialId?: string } = req.body;
    
    imageRef = imageRef?.trim();
    
    if (!imageRef) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'imageRef is required'
      });
    }
    
    // Get credentials
    const creds = await settingsService.getCredentials();
    const registry = getRegistryFromImage(imageRef);
    
    const findCredForRegistry = (reg: string) => {
      return creds.find(c => {
        const storedHost = c.registry.split('/')[0];
        return storedHost === reg || c.registry === reg || c.registry.startsWith(reg + '/');
      });
    };
    
    const cred = credentialId ? creds.find(c => c.id === credentialId) : findCredForRegistry(registry);
    
    logger.info('Inspecting image', { imageRef, registry, credFound: !!cred });
    
    // Check if cached, otherwise download
    let imageData = await cacheService.getCachedImage(imageRef);
    
    if (!imageData) {
      logger.info('Image not cached, downloading...', { imageRef });
      imageData = await cacheService.downloadAndCacheImage(
        imageRef,
        cred ? { id: cred.id, registry: cred.registry, username: cred.username, password: cred.password } : undefined
      );
    }
    
    if (!imageData) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Failed to fetch image: ${imageRef}`
      });
    }
    
    // Parse image ref for display
    const parts = imageRef.split(':');
    const tagPart = parts.length > 1 ? parts[parts.length - 1] : 'latest';
    const namePart = parts.slice(0, -1).join(':') || parts[0];
    const nameParts = namePart.split('/');
    const registryPart = nameParts.length > 2 || (nameParts.length > 1 && nameParts[0].includes('.')) 
      ? nameParts[0] 
      : 'docker.io';
    const repository = nameParts.length > 2 || (nameParts.length > 1 && nameParts[0].includes('.'))
      ? nameParts.slice(1).join('/')
      : namePart;
    
    res.json({
      imageRef: {
        registry: registryPart,
        repository: repository,
        tag: tagPart,
        fullName: imageRef
      },
      config: imageData.config,
      filesystem: imageData.filesystem,
      cachedAt: imageData.cachedAt,
      sizeBytes: imageData.sizeBytes,
      digest: imageData.digest
    });
  } catch (error: any) {
    logger.error('Inspect error', { error: error.message });
    
    if (error?.name === 'AuthError') {
      return res.status(401).json({
        error: 'Authentication Required',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// SSE endpoint for comparison with progress streaming
router.post('/stream', async (req, res) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let { leftImage, rightImage, leftCredentialId, rightCredentialId }: ComparisonRequest = req.body;

    // Trim whitespace from inputs
    leftImage = leftImage?.trim();
    rightImage = rightImage?.trim();

    if (!leftImage || !rightImage) {
      sendEvent('error', { message: 'Both leftImage and rightImage are required' });
      res.end();
      return;
    }

    const comparisonId = uuidv4();
    
    // Get credentials
    const creds = await settingsService.getCredentials();
    const leftRegistry = getRegistryFromImage(leftImage);
    const rightRegistry = getRegistryFromImage(rightImage);
    
    const findCredForRegistry = (registry: string) => {
      return creds.find(c => {
        const storedHost = c.registry.split('/')[0];
        return storedHost === registry || c.registry === registry || c.registry.startsWith(registry + '/');
      });
    };
    
    let leftCred = leftCredentialId ? creds.find(c => c.id === leftCredentialId) : findCredForRegistry(leftRegistry);
    let rightCred = rightCredentialId ? creds.find(c => c.id === rightCredentialId) : findCredForRegistry(rightRegistry);

    // Check if this is single image mode (same image for left and right)
    const isSingleImageMode = leftImage === rightImage;

    // Step 1: Fetch digests
    sendEvent('progress', { side: 'left', percent: 0, status: 'Fetching manifest...' });
    if (!isSingleImageMode) {
      sendEvent('progress', { side: 'right', percent: 0, status: 'Waiting...' });
    }
    
    let leftDigest: string | null = null;
    let rightDigest: string | null = null;
    
    try {
      const leftInfo = await cacheService.getRemoteImageDigest(
        leftImage, 
        leftCred ? { username: leftCred.username, password: leftCred.password } : undefined
      );
      leftDigest = leftInfo?.configDigest || null;
    } catch (err: any) {
      if (err?.name === 'AuthError') {
        sendEvent('error', { 
          message: err.message || `Authentication failed for: ${leftImage}`, 
          details: { registry: leftRegistry, side: 'left', image: leftImage } 
        });
        res.end();
        return;
      }
      throw err;
    }
    
    if (!isSingleImageMode) {
      sendEvent('progress', { side: 'right', percent: 0, status: 'Fetching manifest...' });
    }
    
    try {
      const rightInfo = await cacheService.getRemoteImageDigest(
        rightImage, 
        rightCred ? { username: rightCred.username, password: rightCred.password } : undefined
      );
      rightDigest = rightInfo?.configDigest || null;
    } catch (err: any) {
      if (err?.name === 'AuthError') {
        sendEvent('error', { 
          message: err.message || `Authentication failed for: ${rightImage}`, 
          details: { registry: rightRegistry, side: 'right', image: rightImage } 
        });
        res.end();
        return;
      }
      throw err;
    }

    // Check if images have identical digests (different refs but same content)
    const imagesIdentical = !isSingleImageMode && leftDigest && rightDigest && leftDigest === rightDigest;
    if (imagesIdentical) {
      logger.info('Images are identical (same config digest)', { 
        leftImage, rightImage, digest: leftDigest?.slice(0, 20) 
      });
      // Send notification to frontend that images are identical
      sendEvent('info', { 
        type: 'identical_images',
        message: 'These images have identical content (same digest)',
        digest: leftDigest?.slice(0, 30)
      });
    }

    // Step 2: Download images with progress
    sendEvent('progress', { side: 'left', percent: 5, status: 'Downloading...' });
    
    let leftCached = await cacheService.downloadAndCacheImage(
      leftImage,
      leftCred,
      (progress, status, speedBps) => {
        sendEvent('progress', { side: 'left', percent: progress, status, speedBps });
      }
    );
    
    sendEvent('progress', { side: 'left', percent: 100, status: 'Complete' });
    
    if (!isSingleImageMode) {
      sendEvent('progress', { side: 'right', percent: 5, status: 'Downloading...' });
    }
    
    let rightCached = await cacheService.downloadAndCacheImage(
      rightImage,
      rightCred,
      (progress, status, speedBps) => {
        if (!isSingleImageMode) {
          sendEvent('progress', { side: 'right', percent: progress, status, speedBps });
        }
      }
    );
    
    if (!isSingleImageMode) {
      sendEvent('progress', { side: 'right', percent: 100, status: 'Complete' });
    }

    // Step 3: Perform comparison
    sendEvent('progress', { side: 'both', percent: 100, status: 'Comparing...' });
    const result = comparisonService.compareImages(leftCached, rightCached, comparisonId);

    // Save to history only on successful comparison
    try {
      await historyService.save(result);
    } catch (historyErr) {
      logger.warn('Failed to save to history', { error: historyErr });
    }

    // Send final result
    sendEvent('complete', result);
    res.end();
  } catch (error: any) {
    logger.error('Stream comparison error', { error: error?.message, stack: error?.stack });
    sendEvent('error', { 
      message: error?.message || 'An error occurred during comparison',
      details: error?.name === 'AuthError' ? error.details : undefined
    });
    res.end();
  }
});

export default router;
