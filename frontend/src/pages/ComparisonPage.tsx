import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Tooltip
} from '@mui/material';
import { Terminal as TerminalIcon } from '@mui/icons-material';
import { useComparisonStore } from '../store/comparison';
/**
 * Container Terminal Store Import
 * 
 * IMPORTANT: The container terminal feature requires Docker or Podman.
 * This import is used ONLY for the Terminal button functionality.
 * All other comparison page features work without any container runtime.
 */
import { useContainerTerminalStore } from '../store/containerTerminal';
import MetadataView from '../components/MetadataView';
import FilesystemView from '../components/FilesystemView';
import ImageHistoryView from '../components/ImageHistoryView';

// Use decimal (1000-based) units like Docker does, rounded up to nearest whole number
const formatSize = (bytes?: number) => {
  if (!bytes) return '-';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.ceil(bytes / 1000)} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${Math.ceil(bytes / 1000 / 1000)} MB`;
  return `${(bytes / 1000 / 1000 / 1000).toFixed(1)} GB`;
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

export default function ComparisonPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    currentComparison, 
    loading, 
    error, 
    loadComparison,
    setLeftImageInput,
    setRightImageInput
  } = useComparisonStore();
  
  /**
   * Container Terminal State
   * 
   * IMPORTANT: The terminal feature requires Docker or Podman.
   * If no runtime is detected, the Terminal buttons will be disabled.
   * All other tabs work without any container runtime.
   */
  const { 
    runtimeInfo, 
    fetchRuntimeStatus,
    openTerminalTab
  } = useContainerTerminalStore();
  
  const [activeTab, setActiveTab] = useState(0);
  const [navigateToPath, setNavigateToPath] = useState<string | null>(null);
  const [cacheCheckLoading, setCacheCheckLoading] = useState(false);
  const [repullDialogOpen, setRepullDialogOpen] = useState(false);
  const [uncachedImages, setUncachedImages] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  // Fetch runtime status on mount
  useEffect(() => {
    if (!runtimeInfo) {
      fetchRuntimeStatus();
    }
  }, [runtimeInfo, fetchRuntimeStatus]);

  // Handler for opening terminal from filesystem view folder icon
  const handleOpenTerminal = useCallback((imageRef: string, path: string) => {
    if (!currentComparison) return;
    openTerminalTab(imageRef, path);
  }, [currentComparison, openTerminalTab]);

  // Handler for clickable paths in metadata - switches to filesystem tab and navigates to the path
  const handleNavigateToPath = (path: string) => {
    setNavigateToPath(path);
    setActiveTab(1); // Switch to Filesystem tab
  };

  // Clear the navigation path after it's been consumed
  const clearNavigateToPath = () => {
    setNavigateToPath(null);
  };

  // Check if images are cached when loading a comparison from history
  const checkCacheStatus = async (leftImage: string, rightImage: string, isSingleMode: boolean) => {
    setCacheCheckLoading(true);
    try {
      const imagesToCheck = isSingleMode ? [leftImage] : [leftImage, rightImage];
      const response = await fetch('/api/cache/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imagesToCheck })
      });
      
      if (response.ok) {
        const data = await response.json();
        const leftCached = data.cached[leftImage] ?? true;
        const rightCached = isSingleMode ? true : (data.cached[rightImage] ?? true);
        
        if (!leftCached || !rightCached) {
          setUncachedImages({ left: !leftCached, right: !rightCached });
          setRepullDialogOpen(true);
        }
      }
    } catch (err) {
      console.error('Failed to check cache status:', err);
    } finally {
      setCacheCheckLoading(false);
    }
  };

  // Handle repull confirmation - navigate to home page with pre-filled images
  const handleRepull = () => {
    if (!currentComparison) return;
    
    setRepullDialogOpen(false);
    
    // Set the image inputs for the home page
    setLeftImageInput(currentComparison.leftImage.fullName);
    setRightImageInput(currentComparison.isSingleImageMode ? '' : currentComparison.rightImage.fullName);
    
    // Set auto-submit flag so HomePage will automatically start comparison
    useComparisonStore.getState().setAutoSubmit(true);
    
    // Navigate to home page where user can see download progress
    navigate('/');
  };

  useEffect(() => {
    if (id && (!currentComparison || currentComparison.id !== id)) {
      loadComparison(id);
    }
  }, [id]);

  // Check cache status after comparison is loaded
  useEffect(() => {
    if (currentComparison && currentComparison.id === id && !loading) {
      checkCacheStatus(
        currentComparison.leftImage.fullName,
        currentComparison.rightImage.fullName,
        currentComparison.isSingleImageMode || false
      );
    }
  }, [currentComparison?.id, id, loading]);

  if (loading || cacheCheckLoading) {
    return (
      <Container>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', mt: 8, gap: 2 }}>
          <CircularProgress />
          <Typography>
            {cacheCheckLoading ? 'Checking cache status...' : 'Loading comparison...'}
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Alert severity="error" sx={{ mt: 3 }}>
          {error}
        </Alert>
      </Container>
    );
  }

  if (!currentComparison) {
    return (
      <Container>
        <Alert severity="info" sx={{ mt: 3 }}>
          No comparison data available
        </Alert>
      </Container>
    );
  }

  const isSingleImageMode = currentComparison.isSingleImageMode;
  const isIdenticalContent = currentComparison.isIdenticalContent;
  // Show both names when different image refs have identical content
  const showBothNames = isIdenticalContent && 
    currentComparison.leftImage.fullName !== currentComparison.rightImage.fullName;

  // Terminal button component - opens terminal in new tab
  const TerminalButton = ({ side }: { side: 'left' | 'right' }) => {
    const imageRef = side === 'left' 
      ? currentComparison.leftImage.fullName 
      : currentComparison.rightImage.fullName;
    
    return (
      <Tooltip title={runtimeInfo?.available ? 'Open Terminal in New Tab' : 'Requires Docker or Podman'}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<TerminalIcon />}
            disabled={!runtimeInfo?.available}
            onClick={() => openTerminalTab(imageRef)}
            sx={{ mt: 1 }}
          >
            Terminal
          </Button>
        </span>
      </Tooltip>
    );
  };

  return (
    <Container maxWidth={false} sx={{ maxWidth: '1600px' }}>
      <Box sx={{ mt: 2 }}>
        <Typography variant="h5" gutterBottom>
          {isSingleImageMode ? 'Image Details' : 'Comparing Images'}
        </Typography>
        
        {/* Single image mode: show one full-width card */}
        {isSingleImageMode ? (
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {showBothNames ? 'Images (Same Content)' : 'Image'}
                </Typography>
                <Typography variant="body1" fontFamily="monospace" gutterBottom>
                  {currentComparison.leftImage.fullName}
                </Typography>
                {showBothNames && (
                  <Typography variant="body1" fontFamily="monospace" gutterBottom>
                    {currentComparison.rightImage.fullName}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                  {(currentComparison.leftImage.compressedSizeBytes || currentComparison.leftImage.sizeBytes) && (
                    <Chip size="small" label={`Size: ${formatSize(currentComparison.leftImage.compressedSizeBytes || currentComparison.leftImage.sizeBytes!)}`} />
                  )}
                  {currentComparison.leftImage.created && (
                    <Chip size="small" label={`Created: ${formatDate(currentComparison.leftImage.created)}`} />
                  )}
                </Box>
                {(currentComparison.leftImage.indexDigest || currentComparison.leftImage.manifestDigest) && (
                  <Box sx={{ mt: 1 }}>
                    {currentComparison.leftImage.indexDigest && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        Manifest Digest: {currentComparison.leftImage.indexDigest}
                      </Typography>
                    )}
                    {currentComparison.leftImage.manifestDigest && currentComparison.leftImage.manifestDigest !== currentComparison.leftImage.indexDigest && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        Platform Manifest: {currentComparison.leftImage.manifestDigest}
                      </Typography>
                    )}
                  </Box>
                )}
                <TerminalButton side="left" />
              </Box>
            </Box>
          </Paper>
        ) : (
          /* Comparison mode: show two side-by-side cards */
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Left Image
              </Typography>
              <Typography variant="body1" fontFamily="monospace" gutterBottom>
                {currentComparison.leftImage.fullName}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {(currentComparison.leftImage.compressedSizeBytes || currentComparison.leftImage.sizeBytes) && (
                  <Chip size="small" label={`Size: ${formatSize(currentComparison.leftImage.compressedSizeBytes || currentComparison.leftImage.sizeBytes!)}`} />
                )}
                {currentComparison.leftImage.created && (
                  <Chip size="small" label={`Created: ${formatDate(currentComparison.leftImage.created)}`} />
                )}
              </Box>
              {(currentComparison.leftImage.indexDigest || currentComparison.leftImage.manifestDigest) && (
                <Box sx={{ mt: 1 }}>
                  {currentComparison.leftImage.indexDigest && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      Manifest Digest: {currentComparison.leftImage.indexDigest}
                    </Typography>
                  )}
                  {currentComparison.leftImage.manifestDigest && currentComparison.leftImage.manifestDigest !== currentComparison.leftImage.indexDigest && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      Platform Manifest: {currentComparison.leftImage.manifestDigest}
                    </Typography>
                  )}
                </Box>
              )}
              <TerminalButton side="left" />
            </Paper>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Right Image
              </Typography>
              <Typography variant="body1" fontFamily="monospace" gutterBottom>
                {currentComparison.rightImage.fullName}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {(currentComparison.rightImage.compressedSizeBytes || currentComparison.rightImage.sizeBytes) && (
                  <Chip size="small" label={`Size: ${formatSize(currentComparison.rightImage.compressedSizeBytes || currentComparison.rightImage.sizeBytes!)}`} />
                )}
                {currentComparison.rightImage.created && (
                  <Chip size="small" label={`Created: ${formatDate(currentComparison.rightImage.created)}`} />
                )}
              </Box>
              {(currentComparison.rightImage.indexDigest || currentComparison.rightImage.manifestDigest) && (
                <Box sx={{ mt: 1 }}>
                  {currentComparison.rightImage.indexDigest && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      Manifest Digest: {currentComparison.rightImage.indexDigest}
                    </Typography>
                  )}
                  {currentComparison.rightImage.manifestDigest && currentComparison.rightImage.manifestDigest !== currentComparison.rightImage.indexDigest && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      Platform Manifest: {currentComparison.rightImage.manifestDigest}
                    </Typography>
                  )}
                </Box>
              )}
              <TerminalButton side="right" />
            </Paper>
          </Box>
        )}

        <Paper>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
            <Tab label="Metadata" />
            <Tab label="Filesystem" />
            <Tab label="History" />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {activeTab === 0 && (
              <MetadataView 
                metadata={currentComparison.metadata}
                leftImageRef={currentComparison.leftImage.fullName}
                rightImageRef={isSingleImageMode ? undefined : currentComparison.rightImage.fullName}
                isSingleImageMode={isSingleImageMode}
                onNavigateToPath={handleNavigateToPath}
                fileTree={currentComparison.fileTree.left}
                rightFileTree={isSingleImageMode ? undefined : currentComparison.fileTree.right}
              />
            )}
            {activeTab === 1 && (
              <FilesystemView
                comparisonId={currentComparison.id}
                leftTree={currentComparison.fileTree.left}
                rightTree={currentComparison.fileTree.right}
                filesystemDiff={currentComparison.filesystemDiff}
                leftImageRef={currentComparison.leftImage.fullName}
                rightImageRef={currentComparison.rightImage.fullName}
                isSingleImageMode={isSingleImageMode}
                navigateToPath={navigateToPath}
                onNavigationComplete={clearNavigateToPath}
                onOpenTerminal={handleOpenTerminal}
              />
            )}
            {activeTab === 2 && (
              <ImageHistoryView
                leftImageRef={currentComparison.leftImage.fullName}
                rightImageRef={isSingleImageMode ? undefined : currentComparison.rightImage.fullName}
                isSingleImageMode={isSingleImageMode}
              />
            )}
          </Box>
        </Paper>
      </Box>

      {/* Re-pull dialog for uncached images */}
      <Dialog open={repullDialogOpen} onClose={() => setRepullDialogOpen(false)}>
        <DialogTitle>Images Not Cached</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {uncachedImages.left && uncachedImages.right ? (
              <>Both images are no longer cached and need to be re-pulled:</>
            ) : uncachedImages.left ? (
              <>The left image is no longer cached and needs to be re-pulled:</>
            ) : (
              <>The right image is no longer cached and needs to be re-pulled:</>
            )}
          </DialogContentText>
          <Box sx={{ mt: 2, fontFamily: 'monospace', fontSize: '0.875rem' }}>
            {uncachedImages.left && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'error.main' }}>
                • {currentComparison?.leftImage.fullName}
              </Typography>
            )}
            {uncachedImages.right && !isSingleImageMode && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'error.main' }}>
                • {currentComparison?.rightImage.fullName}
              </Typography>
            )}
          </Box>
          <DialogContentText sx={{ mt: 2 }}>
            Would you like to re-pull the image(s) and run the {isSingleImageMode ? 'inspection' : 'comparison'} again?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRepullDialogOpen(false)}>No, Cancel</Button>
          <Button onClick={handleRepull} variant="contained" color="primary">
            Yes, Re-pull
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
