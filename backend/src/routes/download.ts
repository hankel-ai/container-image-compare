import { Router } from 'express';
import { ImageCacheServiceOCI } from '../services/imageCacheOCI';
import { HistoryService } from '../services/history';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

const router = Router();
const cacheService = new ImageCacheServiceOCI();
const historyService = new HistoryService();

cacheService.init();
historyService.init();

// Download entire filesystem as tar
router.get('/filesystem/:imageRef', async (req, res) => {
  try {
    const { imageRef } = req.params as any;
    const decodedRef = decodeURIComponent(imageRef).trim();
    
    const tarPath = await cacheService.getTarPath(decodedRef);

    // Check if tar exists
    if (!fs.existsSync(tarPath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Image filesystem not found in cache'
      });
    }

    const sanitizedName = decodedRef.replace(/[^a-zA-Z0-9-_.]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}-filesystem.tar"`);
    res.setHeader('Content-Type', 'application/x-tar');

    const readStream = fs.createReadStream(tarPath);
    readStream.pipe(res);
  } catch (error: any) {
    console.error('Filesystem download error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Download Failed',
        message: error.message
      });
    }
  }
});

// Download a single file
router.get('/file/:imageRef/*', async (req, res) => {
  try {
    const { imageRef } = req.params as any;
    const decodedRef = decodeURIComponent(imageRef).trim();
    const filePath = (req.params as any)[0]; // Get the wildcard path
    
    try {
      const content = await cacheService.getFileContentFromTar(decodedRef, filePath);
      const filename = path.basename(filePath);
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(content);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File not found'
        });
      }
      throw err;
    }
  } catch (error: any) {
    console.error('File download error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Download Failed',
        message: error.message
      });
    }
  }
});

// Get file content for diff view
router.get('/content/:imageRef/*', async (req, res) => {
  try {
    const { imageRef } = req.params as any;
    const decodedRef = decodeURIComponent(imageRef).trim();
    const filePath = (req.params as any)[0];
    
    try {
      const content = await cacheService.getFileContentFromTar(decodedRef, filePath);
      
      // Limit to files under 10MB for text display
      if (content.length > 10 * 1024 * 1024) {
        return res.status(413).json({
          error: 'File Too Large',
          message: 'File exceeds 10MB limit for content view'
        });
      }

      // Check for binary content by looking for null bytes in first 8KB
      const sampleSize = Math.min(8000, content.length);
      const sample = content.slice(0, sampleSize);
      let isBinary = false;
      
      // Check for null bytes
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
          isBinary = true;
          break;
        }
      }

      if (isBinary) {
        return res.status(400).json({
          error: 'Binary File',
          message: 'Cannot display binary file content'
        });
      }

      // Try to decode as text
      try {
        const textContent = content.toString('utf-8');
        // Additional check for excessive non-printable characters
        let nonPrintable = 0;
        for (let i = 0; i < Math.min(8000, textContent.length); i++) {
          const code = textContent.charCodeAt(i);
          if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            nonPrintable++;
          }
        }
        
        if (nonPrintable / Math.min(8000, textContent.length) > 0.3) {
          return res.status(400).json({
            error: 'Binary File',
            message: 'File appears to contain binary data'
          });
        }
        
        res.json({ content: textContent, size: content.length });
      } catch {
        // Binary file - UTF-8 decode failed
        res.status(400).json({
          error: 'Binary File',
          message: 'Cannot display binary file content'
        });
      }
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File not found'
        });
      }
      throw err;
    }
  } catch (error: any) {
    console.error('Content fetch error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Fetch Failed',
        message: error.message
      });
    }
  }
});

// Old download endpoint - kept for backwards compatibility
router.post('/', async (req, res) => {
  try {
    const { comparisonId, imageSide, path: filePath, type } = req.body;

    const comparison = await historyService.getById(comparisonId);
    if (!comparison) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Comparison not found'
      });
    }

    const imageRef = imageSide === 'left' 
      ? comparison.leftImage.fullName 
      : comparison.rightImage.fullName;

    if (type === 'file') {
      const content = await cacheService.getFileContent(imageRef, filePath);
      const filename = path.basename(filePath);
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(content);
    } else {
      // Download directory as zip
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}.zip"`);
      res.setHeader('Content-Type', 'application/zip');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      // Add directory to archive (implementation would need full path resolution)
      archive.finalize();
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Download Failed',
      message: error.message
    });
  }
});

// Download config.json for an image
router.get('/config/:imageRef', async (req, res) => {
  try {
    const { imageRef } = req.params as any;
    const decodedRef = decodeURIComponent(imageRef).trim();
    
    const cachedImage = await cacheService.getCachedImage(decodedRef);
    if (!cachedImage) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Image not found in cache'
      });
    }

    const sanitizedName = decodedRef.replace(/[^a-zA-Z0-9-_.]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}-config.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(cachedImage.config, null, 2));
  } catch (error: any) {
    console.error('Config download error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Download Failed',
        message: error.message
      });
    }
  }
});

// Get docker history for an image (equivalent to "docker history <image> --no-trunc")
router.get('/history/:imageRef', async (req, res) => {
  try {
    const { imageRef } = req.params as any;
    const decodedRef = decodeURIComponent(imageRef).trim();
    
    const cachedImage = await cacheService.getCachedImage(decodedRef);
    if (!cachedImage) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Image not found in cache'
      });
    }

    // Extract history from the image config
    // Docker history format includes: created, created_by, empty_layer, comment
    const config = cachedImage.config;
    const history = config.history || [];
    const diffIds = config.rootfs?.diff_ids || [];
    
    // Map history entries, associating layer digests where applicable
    let layerIndex = 0;
    const historyEntries = history.map((entry: any, idx: number) => {
      const isEmptyLayer = entry.empty_layer === true;
      let layerDigest: string | undefined;
      let layerSize: number | undefined;
      
      if (!isEmptyLayer && layerIndex < diffIds.length) {
        layerDigest = diffIds[layerIndex];
        layerIndex++;
      }
      
      return {
        id: idx,
        created: entry.created,
        createdBy: entry.created_by || '',
        size: layerSize || 0,  // Size not available in config history
        comment: entry.comment || '',
        emptyLayer: isEmptyLayer,
        layerDigest
      };
    });

    // Reverse to show newest first (like docker history)
    res.json({ 
      history: historyEntries.reverse(),
      totalLayers: diffIds.length
    });
  } catch (error: any) {
    console.error('History fetch error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Fetch Failed',
        message: error.message
      });
    }
  }
});

export default router;
