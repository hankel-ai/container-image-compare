import { Router } from 'express';
import { HistoryService } from '../services/history';

const router = Router();
const historyService = new HistoryService();

historyService.init();

// Get all comparison history
router.get('/', async (req, res) => {
  try {
    const history = await historyService.getAll();
    res.json(history);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Get recent images (unique image refs from history)
router.get('/recent-images', async (req, res) => {
  try {
    const history = await historyService.getAll();
    const imageMap = new Map<string, string>(); // imageRef -> lastUsed date
    
    // Collect unique images from history (most recent first)
    for (const entry of history) {
      if (!imageMap.has(entry.leftImage)) {
        imageMap.set(entry.leftImage, entry.createdAt);
      }
      if (!entry.isSingleImageMode && entry.rightImage && !imageMap.has(entry.rightImage)) {
        imageMap.set(entry.rightImage, entry.createdAt);
      }
    }
    
    // Convert to array and limit to 20 most recent
    const recentImages = Array.from(imageMap.entries())
      .map(([imageRef, lastUsed]) => ({ imageRef, lastUsed }))
      .slice(0, 20);
    
    res.json(recentImages);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Delete a history entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await historyService.delete(id);

    if (!deleted) {
      return res.status(404).json({
        error: 'Not Found',
        message: `History entry with ID ${id} not found`
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Clear all history
router.delete('/', async (req, res) => {
  try {
    const count = await historyService.clearAll();
    res.json({ success: true, deletedCount: count });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

export default router;
