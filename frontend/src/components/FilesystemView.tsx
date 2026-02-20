import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  FormControlLabel,
  Checkbox,
  IconButton,
  Button,
  CircularProgress,
  Backdrop
} from '@mui/material';
import { Download, UnfoldLess, UnfoldMore } from '@mui/icons-material';
import { FileNode, FileDiff } from '../../../shared/types';
import FileTree from './FileTree';
import FileContentDiff from './FileContentDiff';
/**
 * Container Terminal Store Import
 * 
 * IMPORTANT: The container terminal feature requires Docker or Podman.
 * This import is used ONLY for the terminal icon on folder hover.
 * All other filesystem view functionality works without any container runtime.
 */
import { useContainerTerminalStore } from '../store/containerTerminal';

interface FilesystemViewProps {
  comparisonId: string;
  leftTree: FileNode;
  rightTree: FileNode;
  filesystemDiff: FileDiff[];
  leftImageRef: string;
  rightImageRef: string;
  isSingleImageMode?: boolean;
  navigateToPath?: string | null;
  onNavigationComplete?: () => void;
  /**
   * Callback to open terminal at a specific path
   * 
   * IMPORTANT: This feature requires Docker or Podman to be installed.
   * If no runtime is detected, the terminal icon will not be shown.
   */
  onOpenTerminal?: (imageRef: string, path: string) => void;
}

export default function FilesystemView({
  leftTree,
  rightTree,
  filesystemDiff,
  leftImageRef,
  rightImageRef,
  isSingleImageMode,
  navigateToPath,
  onNavigationComplete,
  onOpenTerminal
}: FilesystemViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingSynced = useRef(false);

  /**
   * Container Runtime Availability
   * 
   * IMPORTANT: This is used ONLY for the terminal icon feature.
   * The terminal icon on folder hover requires Docker or Podman.
   * All other filesystem view features work without any container runtime.
   */
  const { runtimeInfo } = useContainerTerminalStore();
  const terminalAvailable = runtimeInfo?.available ?? false;

  // Handler for opening terminal at a folder path
  const handleOpenTerminal = useCallback((path: string, imageRef: string) => {
    if (onOpenTerminal && terminalAvailable) {
      onOpenTerminal(imageRef, path);
    }
  }, [onOpenTerminal, terminalAvailable]);

  // Defer rendering to prevent UI freeze on large trees
  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle navigation from external source (e.g., clicking a path in metadata)
  useEffect(() => {
    if (navigateToPath && isReady) {
      // Expand all parent directories of the target path
      const pathParts = navigateToPath.split('/').filter(Boolean);
      const pathsToExpand = new Set<string>();
      let currentPath = '';
      
      // Build all parent paths
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentPath += '/' + pathParts[i];
        pathsToExpand.add(currentPath);
      }
      
      // Also expand the target path itself if it's a folder
      const targetPath = '/' + pathParts.join('/');
      pathsToExpand.add(targetPath);
      
      // Add to expanded paths
      setExpandedPaths(prev => {
        const newSet = new Set(prev);
        pathsToExpand.forEach(p => newSet.add(p));
        return newSet;
      });
      
      // Select the target path (could be file or directory)
      setSelectedPath(targetPath);
      
      // Scroll to the element after a brief delay to allow rendering
      setTimeout(() => {
        const element = document.querySelector(`[data-path="${targetPath}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      
      // Clear the navigation request
      onNavigationComplete?.();
    }
  }, [navigateToPath, isReady, onNavigationComplete]);

  // Create a map for O(1) diff lookups instead of O(n) array searches
  const diffMap = useMemo(() => {
    const map = new Map<string, FileDiff>();
    filesystemDiff.forEach(diff => map.set(diff.path, diff));
    return map;
  }, [filesystemDiff]);

  const handleFileSelect = useCallback((path: string) => {
    // Only set selected path - loading happens in FileContentDiff
    setSelectedPath(path);
  }, []);

  // Handle symlink folder navigation - navigate to and expand target folder
  const handleNavigateToSymlinkTarget = useCallback((targetPath: string) => {
    // Expand all parent folders of the target
    const pathParts = targetPath.split('/').filter(Boolean);
    const pathsToExpand = new Set<string>();
    let currentPath = '';
    for (const part of pathParts) {
      currentPath = currentPath + '/' + part;
      pathsToExpand.add(currentPath);
    }
    
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      pathsToExpand.forEach(p => newSet.add(p));
      return newSet;
    });
    
    // Set selected path to scroll to it
    setSelectedPath(targetPath);
    
    // Scroll to the target after a short delay to allow expansion
    setTimeout(() => {
      const element = document.querySelector(`[data-path="${targetPath}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, []);

  // Check if a path is a file (not a directory) by looking it up in either tree
  const isFilePath = useCallback((path: string): boolean => {
    const findNode = (node: FileNode, targetPath: string): FileNode | null => {
      if (node.path === targetPath) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child, targetPath);
          if (found) return found;
        }
      }
      return null;
    };
    
    // Check both trees - file may only exist on one side
    const leftNode = findNode(leftTree, path);
    if (leftNode?.type === 'file') return true;
    
    const rightNode = findNode(rightTree, path);
    return rightNode?.type === 'file';
  }, [leftTree, rightTree]);

  const handleToggleExpand = useCallback((path: string) => {
    // Instant folder expansion/collapse
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allPaths = new Set<string>();
    const collectPaths = (node: FileNode) => {
      if (node.type === 'directory') {
        allPaths.add(node.path);
        node.children?.forEach(collectPaths);
      }
    };
    collectPaths(leftTree);
    collectPaths(rightTree);
    setExpandedPaths(allPaths);
  }, [leftTree, rightTree]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const handleDownloadFilesystem = async (side: 'left' | 'right') => {
    try {
      const imageRef = side === 'left' ? leftImageRef : rightImageRef;
      const response = await fetch(`/api/download/filesystem/${encodeURIComponent(imageRef)}`);
      
      if (!response.ok) {
        console.error('Download failed');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${imageRef.replace(/[^a-zA-Z0-9-_.]/g, '_')}-filesystem.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  // Sync scrolling between panes
  const handleScroll = (source: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollingSynced.current) {
      isScrollingSynced.current = false;
      return;
    }

    const sourceElement = e.currentTarget;
    const targetElement = source === 'left' ? rightScrollRef.current : leftScrollRef.current;

    if (targetElement) {
      isScrollingSynced.current = true;
      targetElement.scrollTop = sourceElement.scrollTop;
    }
  };

  const hasChildWithDiff = useCallback((node: FileNode, diffMap: Map<string, FileDiff>): boolean => {
    const diff = diffMap.get(node.path);
    if (diff && diff.status !== 'same') return true;
    
    if (node.children) {
      return node.children.some(child => hasChildWithDiff(child, diffMap));
    }
    return false;
  }, []);

  const filterTree = useCallback((node: FileNode): FileNode | null => {
    if (!showOnlyDifferences && !activeSearch) return node;

    let shouldInclude = false;
    let matchesSearch = true;
    let matchesDiff = true;

    // Search filter - include if node or any child matches
    if (activeSearch) {
      const searchLower = activeSearch.toLowerCase();
      matchesSearch = node.path.toLowerCase().includes(searchLower) || 
                      (node.children?.some(child => filterTree(child) !== null) ?? false);
    }

    // Diff filter - include if node or any child has differences
    if (showOnlyDifferences) {
      matchesDiff = hasChildWithDiff(node, diffMap);
    }

    shouldInclude = matchesSearch && matchesDiff;

    if (!shouldInclude) return null;

    if (node.children) {
      const filteredChildren = node.children
        .map(child => filterTree(child))
        .filter((child): child is FileNode => child !== null);
      
      // Skip empty directories from filtering
      if (filteredChildren.length === 0 && node.type === 'directory' && (showOnlyDifferences || activeSearch)) {
        return null;
      }
      
      return { ...node, children: filteredChildren };
    }

    return node;
  }, [showOnlyDifferences, activeSearch, hasChildWithDiff, diffMap]);

  // Deduplicate tree nodes (safety measure for data with duplicate children)
  const deduplicateTree = useCallback((node: FileNode): FileNode => {
    if (!node.children || node.children.length === 0) {
      return node;
    }

    // Deduplicate children by name (case-insensitive)
    const seenNames = new Map<string, FileNode>();
    const uniqueChildren: FileNode[] = [];

    node.children.forEach(child => {
      const normalizedName = child.name.toLowerCase();
      const existing = seenNames.get(normalizedName);

      if (!existing) {
        seenNames.set(normalizedName, child);
        uniqueChildren.push(deduplicateTree(child));
      } else {
        // If duplicate, merge metadata from both versions
        const existingChildCount = existing.children?.length || 0;
        const newChildCount = child.children?.length || 0;

        // Prefer the version with more metadata/children
        const preferred = newChildCount > existingChildCount ? child : existing;
        const other = newChildCount > existingChildCount ? existing : child;

        // Merge metadata - prefer non-empty values
        const merged: FileNode = {
          ...preferred,
          mode: preferred.mode || other.mode,
          size: preferred.size ?? other.size,
          uid: preferred.uid ?? other.uid,
          gid: preferred.gid ?? other.gid,
          mtime: preferred.mtime || other.mtime,
          linkname: preferred.linkname || other.linkname,
        };

        // Replace existing entry with merged version
        const index = uniqueChildren.findIndex(c => c.name.toLowerCase() === normalizedName);
        if (index !== -1) {
          uniqueChildren[index] = deduplicateTree(merged);
          seenNames.set(normalizedName, merged);
        }
      }
    });

    return { ...node, children: uniqueChildren };
  }, []);

  const filteredLeftTree = useMemo(() => {
    const deduplicated = deduplicateTree(leftTree);
    return filterTree(deduplicated);
  }, [leftTree, filterTree, deduplicateTree]);
  
  const filteredRightTree = useMemo(() => {
    const deduplicated = deduplicateTree(rightTree);
    return filterTree(deduplicated);
  }, [rightTree, filterTree, deduplicateTree]);

  if (!isReady) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Loading filesystem tree...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search files... (press Enter to search)"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setActiveSearch(searchTerm);
            } else if (e.key === 'Escape') {
              setSearchTerm('');
              setActiveSearch('');
            }
          }}
          sx={{ flex: 1, minWidth: '200px' }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showOnlyDifferences}
              onChange={(e) => {
                // When unchecking "Show only differences", collapse all first
                // to prevent massive UI delay from rendering entire expanded filesystem
                if (!e.target.checked && showOnlyDifferences) {
                  handleCollapseAll();
                }
                setShowOnlyDifferences(e.target.checked);
              }}
              disabled={isSingleImageMode}
            />
          }
          label="Show only differences"
        />
        <Button
          size="small"
          startIcon={<UnfoldMore />}
          onClick={handleExpandAll}
          variant="outlined"
        >
          Expand All
        </Button>
        <Button
          size="small"
          startIcon={<UnfoldLess />}
          onClick={handleCollapseAll}
          variant="outlined"
        >
          Collapse All
        </Button>
      </Box>

      {/* Single image mode: show one full-width pane */}
      {isSingleImageMode ? (
        <Paper sx={{ p: 2, height: '600px', overflow: 'auto' }} ref={leftScrollRef}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              Filesystem
            </Typography>
            <IconButton size="small" onClick={() => handleDownloadFilesystem('left')}>
              <Download />
            </IconButton>
          </Box>
          {filteredLeftTree && (
            <FileTree
              node={filteredLeftTree}
              onSelect={handleFileSelect}
              selectedPath={selectedPath}
              diffMap={diffMap}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onNavigateToSymlinkTarget={handleNavigateToSymlinkTarget}
              imageRef={leftImageRef}
              onOpenTerminal={(path) => handleOpenTerminal(path, leftImageRef)}
              terminalAvailable={terminalAvailable}
            />
          )}
        </Paper>
      ) : (
        /* Comparison mode: show two side-by-side panes */
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Paper sx={{ p: 2, height: '600px', overflow: 'auto' }} ref={leftScrollRef} onScroll={handleScroll('left')}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Left Image
                </Typography>
                <IconButton size="small" onClick={() => handleDownloadFilesystem('left')}>
                  <Download />
                </IconButton>
              </Box>
              {filteredLeftTree && (
                <FileTree
                  node={filteredLeftTree}
                  onSelect={handleFileSelect}
                  selectedPath={selectedPath}
                  diffMap={diffMap}
                  expandedPaths={expandedPaths}
                  onToggleExpand={handleToggleExpand}
                  onNavigateToSymlinkTarget={handleNavigateToSymlinkTarget}
                  imageRef={leftImageRef}
                  onOpenTerminal={(path) => handleOpenTerminal(path, leftImageRef)}
                  terminalAvailable={terminalAvailable}
                />
              )}
            </Paper>
          </Grid>

          <Grid item xs={6}>
            <Paper sx={{ p: 2, height: '600px', overflow: 'auto' }} ref={rightScrollRef} onScroll={handleScroll('right')}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Right Image
                </Typography>
                <IconButton size="small" onClick={() => handleDownloadFilesystem('right')}>
                  <Download />
                </IconButton>
              </Box>
              {filteredRightTree && (
                <FileTree
                  node={filteredRightTree}
                  onSelect={handleFileSelect}
                  selectedPath={selectedPath}
                  diffMap={diffMap}
                  expandedPaths={expandedPaths}
                  onToggleExpand={handleToggleExpand}
                  onNavigateToSymlinkTarget={handleNavigateToSymlinkTarget}
                  imageRef={rightImageRef}
                  onOpenTerminal={(path) => handleOpenTerminal(path, rightImageRef)}
                  terminalAvailable={terminalAvailable}
                />
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      {selectedPath && isFilePath(selectedPath) && (
        <>
          <Backdrop
            sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
            open={fileContentLoading}
          >
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress color="inherit" />
              <Typography sx={{ mt: 2 }}>Loading file content...</Typography>
            </Box>
          </Backdrop>
          <FileContentDiff
            leftImageRef={leftImageRef}
            rightImageRef={isSingleImageMode ? leftImageRef : rightImageRef}
            filePath={selectedPath}
            onLoadingChange={setFileContentLoading}
            isSingleImageMode={isSingleImageMode}
          />
        </>
      )}
    </Box>
  );
}
