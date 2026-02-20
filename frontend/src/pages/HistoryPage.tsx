import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Paper,
  IconButton,
  Box,
  Chip,
  Button
} from '@mui/material';
import { Visibility, Delete, DeleteSweep } from '@mui/icons-material';
import { ComparisonHistory } from '../../../shared/types';

export default function HistoryPage() {
  const [history, setHistory] = useState<ComparisonHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/history');
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
      setHistory(history.filter(h => h.id !== id));
    } catch (error) {
      console.error('Failed to delete history:', error);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL comparison history? This cannot be undone.')) {
      return;
    }
    try {
      await fetch('/api/history', { method: 'DELETE' });
      setHistory([]);
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5">
            Comparison History
          </Typography>
          {history.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweep />}
              onClick={handleClearAll}
            >
              Clear All History
            </Button>
          )}
        </Box>

        {history.length === 0 && !loading ? (
          <Paper sx={{ p: 3 }}>
            <Typography color="text.secondary" align="center">No comparison history available</Typography>
          </Paper>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {history.map((item) => {
              // Show both image names when different refs have identical content
              const showBothNames = item.isIdenticalContent && item.leftImage !== item.rightImage;
              const isSingleOrIdentical = item.isSingleImageMode || item.isIdenticalContent;
              
              return (
              <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  {/* Left side: Date and image references */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {new Date(item.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </Typography>
                    <Box sx={{ display: 'flex', mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ width: 50, flexShrink: 0 }}>
                        {showBothNames ? 'Image 1:' : (isSingleOrIdentical ? 'Image:' : 'Left:')}
                      </Typography>
                      <Typography 
                        component="span"
                        variant="body2" 
                        sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}
                      >
                        {item.leftImage}
                      </Typography>
                    </Box>
                    {showBothNames && (
                      <Box sx={{ display: 'flex', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ width: 50, flexShrink: 0 }}>
                          Image 2:
                        </Typography>
                        <Typography 
                          component="span"
                          variant="body2" 
                          sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}
                        >
                          {item.rightImage}
                        </Typography>
                      </Box>
                    )}
                    {!isSingleOrIdentical && (
                      <Box sx={{ display: 'flex' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ width: 50, flexShrink: 0 }}>
                          Right:
                        </Typography>
                        <Typography 
                          component="span"
                          variant="body2" 
                          sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}
                        >
                          {item.rightImage}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  {/* Right side: Icons and diff chips */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', ml: 2 }}>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/comparison/${item.id}`)}
                        title="View comparison"
                      >
                        <Visibility />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(item.id)}
                        title="Delete"
                      >
                        <Delete />
                      </IconButton>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                      {item.summary.addedFiles > 0 && (
                        <Chip label={`+${item.summary.addedFiles}`} size="small" color="success" />
                      )}
                      {item.summary.removedFiles > 0 && (
                        <Chip label={`-${item.summary.removedFiles}`} size="small" color="error" />
                      )}
                      {item.summary.modifiedFiles > 0 && (
                        <Chip label={`~${item.summary.modifiedFiles}`} size="small" color="warning" />
                      )}
                    </Box>
                  </Box>
                </Box>
              </Paper>
            );
            })}
          </Box>
        )}
      </Box>
    </Container>
  );
}
