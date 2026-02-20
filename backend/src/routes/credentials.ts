import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  res.json([]);
});

router.post('/', async (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented',
    message: 'Credential storage not yet implemented.'
  });
});

router.put('/:id', async (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented',
    message: 'Credential management not yet implemented.'
  });
});

router.delete('/:id', async (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented',
    message: 'Credential management not yet implemented.'
  });
});

export default router;
