import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  LinearProgress,
  Autocomplete,
  IconButton,
  Tooltip,
  Snackbar
} from '@mui/material';
import { CompareArrows, SwapVert } from '@mui/icons-material';
import { useComparisonStore } from '../store/comparison';
import { RecentImage } from '../../../shared/types';

// Format download speed to human readable string
function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond) return '';
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

export default function HomePage() {
  // Use Zustand store for image inputs - persists across tab navigation
  const { 
    leftImageInput: leftImage, 
    rightImageInput: rightImage,
    setLeftImageInput: setLeftImage,
    setRightImageInput: setRightImage,
    startComparison, 
    loading, 
    error, 
    progress, 
    authDetails,
    autoSubmit,
    setAutoSubmit,
    imagesIdentical,
    identicalDigest,
    clearImagesIdentical
  } = useComparisonStore();
  const navigate = useNavigate();
  const [recentImages, setRecentImages] = useState<RecentImage[]>([]);

  // Load recent images on mount
  useEffect(() => {
    fetch('/api/history/recent-images')
      .then(res => res.json())
      .then(data => setRecentImages(data))
      .catch(() => setRecentImages([]));
  }, []);

  // Auto-submit when redirected from history repull
  useEffect(() => {
    if (autoSubmit && leftImage && !loading) {
      setAutoSubmit(false);
      handleCompare();
    }
  }, [autoSubmit, leftImage, loading]);

  // Determine which side has the error (for showing inline error)
  const leftError = authDetails?.side === 'left' ? error : null;
  const rightError = authDetails?.side === 'right' ? error : null;
  const generalError = (!authDetails?.side && error) ? error : null;

  // Swap left and right images
  const handleSwap = () => {
    const temp = leftImage;
    setLeftImage(rightImage);
    setRightImage(temp);
  };

  const handleCompare = async () => {
    if (!leftImage) return;

    await startComparison(leftImage, rightImage || leftImage);

    const comparison = useComparisonStore.getState().currentComparison;
    if (comparison) {
      // Keep input values during session - don't clear
      navigate(`/comparison/${comparison.id}`);
    }
    // On error, keep the inputs so user can fix credentials and retry
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 4 }}>
        <Typography variant="h4" gutterBottom align="center">
          Compare Container Images
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph align="center">
          Enter two container image references to compare their metadata and filesystems
        </Typography>

        <Paper sx={{ p: 4, mt: 3 }}>
          {/* Left Image Input with Progress */}
          <Box sx={{ mb: 3 }}>
            <Autocomplete
              freeSolo
              options={recentImages.map(img => img.imageRef)}
              value={leftImage}
              onInputChange={(_, value) => setLeftImage(value)}
              disabled={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="Left Image"
                  placeholder="e.g., nginx:1.25.0, docker.io/library/nginx:latest, or image@sha256:..."
                  error={!!leftError}
                />
              )}
            />
            {loading && progress && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {progress.left.status}
                    {progress.left.speedBps ? ` • ${formatSpeed(progress.left.speedBps)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {Math.floor(progress.left.percent)}%
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={progress.left.percent}
                  sx={{ height: 8, borderRadius: 1 }}
                  color={progress.left.percent === 100 ? 'success' : 'primary'}
                />
              </Box>
            )}
            {leftError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {leftError}
              </Alert>
            )}
          </Box>

          {/* Swap Button */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Tooltip title="Swap left and right images">
              <IconButton 
                onClick={handleSwap} 
                disabled={loading || (!leftImage && !rightImage)}
                color="primary"
                size="small"
              >
                <SwapVert />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Right Image Input with Progress */}
          <Box sx={{ mb: 3 }}>
            <Autocomplete
              freeSolo
              options={recentImages.map(img => img.imageRef)}
              value={rightImage}
              onInputChange={(_, value) => setRightImage(value)}
              disabled={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="Right Image (optional - leave empty to inspect single image)"
                  placeholder="e.g., nginx:1.26.0"
                  error={!!rightError}
                  helperText={!rightImage && !loading ? 'Leave empty to inspect a single image' : ''}
                />
              )}
            />
            {loading && progress && !(!rightImage) && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {progress.right.status}
                    {progress.right.speedBps ? ` • ${formatSpeed(progress.right.speedBps)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {Math.floor(progress.right.percent)}%
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={progress.right.percent}
                  sx={{ height: 8, borderRadius: 1 }}
                  color={progress.right.percent === 100 ? 'success' : 'primary'}
                />
              </Box>
            )}
            {rightError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {rightError}
              </Alert>
            )}
          </Box>

          {generalError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {generalError}
            </Alert>
          )}

          {!!rightImage && leftImage.trim() === rightImage.trim() && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Left and right images are identical. Leave right image empty to inspect a single image, or enter different images to compare.
            </Alert>
          )}

          <Button
            fullWidth
            variant="contained"
            size="large"
            startIcon={loading ? <CircularProgress size={20} /> : <CompareArrows />}
            onClick={handleCompare}
            disabled={loading || !leftImage || (!!rightImage && leftImage.trim() === rightImage.trim())}
          >
            {loading ? (rightImage ? 'Comparing...' : 'Inspecting...') : (rightImage ? 'Compare Images' : 'Inspect Image')}
          </Button>
        </Paper>

      </Box>

      {/* Snackbar alert when comparing identical images */}
      <Snackbar
        open={imagesIdentical}
        autoHideDuration={6000}
        onClose={clearImagesIdentical}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={clearImagesIdentical} 
          severity="warning" 
          variant="filled"
          sx={{ width: '100%' }}
        >
          These images have identical content (same digest){identicalDigest ? `: ${identicalDigest}...` : ''}
        </Alert>
      </Snackbar>
    </Container>
  );
}
