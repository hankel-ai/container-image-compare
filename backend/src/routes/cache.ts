import { Router } from 'express';
import { APP_PATHS } from '../services/settings';
import { ImageCacheServiceOCI } from '../services/imageCacheOCI';

const router = Router();
const cacheService = new ImageCacheServiceOCI();

// Get cache statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await cacheService.getCacheStats();
    
    res.json({
      totalSizeGB: stats.totalSizeGB,
      totalSizeBytes: stats.totalSizeBytes,
      podmanSizeGB: stats.podmanSizeGB,
      podmanSizeBytes: stats.podmanSizeBytes,
      combinedSizeGB: stats.combinedSizeGB,
      combinedSizeBytes: stats.combinedSizeBytes,
      imageCount: stats.entryCount,
      cacheDir: APP_PATHS.cache
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// List all cached images
router.get('/entries', async (req, res) => {
  try {
    const stats = await cacheService.getCacheStats();
    
    res.json({
      entries: stats.entries.map(e => ({
        imageRefs: e.imageRefs,
        sizeGB: e.sizeBytes / (1024 * 1024 * 1024),
        sizeBytes: e.sizeBytes,
        lastModified: e.lastModified,
        cacheDir: e.cacheDir
      })),
      totalCount: stats.entryCount,
      totalSizeGB: stats.totalSizeGB
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Clear cache
router.post('/clear', async (req, res) => {
  try {
    const result = await cacheService.clearCache();
    
    res.json({ 
      success: true, 
      message: 'Cache cleared successfully',
      removedCount: result.removedCount,
      freedGB: result.freedBytes / (1024 * 1024 * 1024)
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Enforce cache limit
router.post('/enforce-limit', async (req, res) => {
  try {
    const { maxSizeGB } = req.body;
    if (typeof maxSizeGB !== 'number' || maxSizeGB <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'maxSizeGB must be a positive number' });
    }
    
    const result = await cacheService.enforceCacheLimit(maxSizeGB);
    
    res.json({
      success: true,
      removedCount: result.removedCount,
      freedGB: result.freedBytes / (1024 * 1024 * 1024)
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Delete a single cache entry
router.delete('/entry/:dirName', async (req, res) => {
  try {
    const { dirName } = req.params;
    if (!dirName) {
      return res.status(400).json({ error: 'Bad Request', message: 'dirName is required' });
    }
    
    const result = await cacheService.deleteCacheEntry(dirName);
    
    if (!result.success) {
      return res.status(404).json({ error: 'Not Found', message: 'Cache entry not found' });
    }
    
    res.json({
      success: true,
      message: 'Cache entry deleted successfully',
      freedGB: result.freedBytes / (1024 * 1024 * 1024)
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Check if images are cached
router.post('/check', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Bad Request', message: 'images array is required' });
    }
    
    const results: { [key: string]: boolean } = {};
    for (const imageRef of images) {
      results[imageRef] = await cacheService.isImageCached(imageRef);
    }
    
    res.json({ cached: results });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

export default router;
