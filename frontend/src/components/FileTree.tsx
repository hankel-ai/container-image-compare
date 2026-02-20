import React from 'react';
import { Box, Typography, IconButton, Collapse, Tooltip } from '@mui/material';
import {
  Folder,
  FolderOpen,
  InsertDriveFile,
  ExpandMore,
  ChevronRight,
  Add,
  Remove,
  Download,
  Link,
  FolderSpecial,
  Terminal
} from '@mui/icons-material';
import { FileNode, FileDiff } from '../../../shared/types';

interface FileTreeProps {
  node: FileNode;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  diffMap: Map<string, FileDiff>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onNavigateToSymlinkTarget?: (targetPath: string) => void;
  imageRef?: string;
  level?: number;
  /**
   * Callback for opening terminal at a specific folder path
   * 
   * IMPORTANT: This feature requires Docker or Podman to be installed.
   * The terminal icon will only be shown if onOpenTerminal is provided
   * AND the container runtime is available.
   */
  onOpenTerminal?: (path: string) => void;
  /** Whether the terminal feature is available (Docker/Podman detected) */
  terminalAvailable?: boolean;
}

const FileTree = React.memo(function FileTree({
  node,
  onSelect,
  selectedPath,
  diffMap,
  expandedPaths,
  onToggleExpand,
  onNavigateToSymlinkTarget,
  imageRef,
  level = 0,
  onOpenTerminal,
  terminalAvailable = false
}: FileTreeProps) {
  // Skip rendering the root "/" node and render its children directly
  if (node.path === '/' && level === 0 && Array.isArray(node.children)) {
    return (
      <Box>
        {node.children.map((child, index) => (
          <FileTree
            key={`${child.path}-${index}`}
            node={child}
            onSelect={onSelect}
            selectedPath={selectedPath}
            diffMap={diffMap}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
            onNavigateToSymlinkTarget={onNavigateToSymlinkTarget}
            imageRef={imageRef}
            level={0}
            onOpenTerminal={onOpenTerminal}
            terminalAvailable={terminalAvailable}
          />
        ))}
      </Box>
    );
  }

  const expanded = expandedPaths.has(node.path);
  const diff = diffMap.get(node.path);
  const isSelected = selectedPath === node.path;

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'added': return '#4caf50';
      case 'removed': return '#f44336';
      case 'modified': return '#ff9800';
      default: return 'inherit';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'added': return <Add fontSize="small" sx={{ color: '#4caf50' }} />;
      case 'removed': return <Remove fontSize="small" sx={{ color: '#f44336' }} />;
      default: return null;
    }
  };

  const formatPermissions = (mode?: number | string) => {
    if (mode === undefined) return '';
    let numMode: number | undefined;
    if (typeof mode === 'string') {
      if (mode.startsWith('0o')) {
        numMode = parseInt(mode.slice(2), 8);
      } else if (mode.startsWith('0') && mode.length > 1) {
        numMode = parseInt(mode, 8);
      } else {
        numMode = parseInt(mode, 10);
      }
    } else {
      numMode = mode;
    }
    if (typeof numMode !== 'number' || Number.isNaN(numMode)) return '';
    const octal = (numMode & 0o777).toString(8).padStart(3, '0');
    const perms = [];
    const chars = ['r', 'w', 'x'];
    for (let i = 0; i < 3; i++) {
      const digit = parseInt(octal[i]);
      let perm = '';
      for (let j = 0; j < 3; j++) {
        perm += (digit & (1 << (2 - j))) ? chars[j] : '-';
      }
      perms.push(perm);
    }
    return perms.join('');
  };

  const formatDate = (date?: Date) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString('en-US', { 
      month: 'short', 
      day: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Determine if symlink points to a directory (linkTarget ends with / or linkname ends with /)
  const isSymlinkFolder = node.type === 'symlink' && (
    node.linkTarget?.endsWith('/') || 
    node.linkname?.endsWith('/') ||
    // Also check if the node has children (indicating it's a resolved directory symlink)
    (Array.isArray(node.children) && node.children.length > 0)
  );

  // Helper to resolve symlink target path
  const resolveSymlinkTarget = (linkTarget: string): string => {
    let targetPath = linkTarget;
    if (!targetPath.startsWith('/')) {
      // Relative path - resolve relative to the parent directory
      const parentDir = node.path.substring(0, node.path.lastIndexOf('/'));
      targetPath = `${parentDir}/${targetPath}`;
    }
    // Remove trailing slash for consistent path matching
    targetPath = targetPath.replace(/\/+$/, '');
    // Normalize path (remove .. and .)
    const parts = targetPath.split('/').filter(Boolean);
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.') {
        normalized.push(part);
      }
    }
    return '/' + normalized.join('/');
  };

  const handleClick = () => {
    // Check if this is any symlink (file or folder) - navigate to target
    // Use linkTarget if available, otherwise fall back to linkname (backend uses linkname)
    const symlinkTarget = node.linkTarget || node.linkname;
    if (node.type === 'symlink' && symlinkTarget && onNavigateToSymlinkTarget) {
      const finalPath = resolveSymlinkTarget(symlinkTarget);
      onNavigateToSymlinkTarget(finalPath);
    } else if (node.type === 'directory') {
      onToggleExpand(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!imageRef) {
      console.error('Image reference not provided');
      return;
    }

    try {
      const response = await fetch(`/api/download/file/${encodeURIComponent(imageRef)}/${node.path}`);
      
      if (!response.ok) {
        console.error('Download failed');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = node.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  /**
   * Handle opening terminal at this folder path
   * 
   * IMPORTANT: This feature requires Docker or Podman to be installed.
   * The terminal icon is only shown when terminalAvailable is true.
   */
  const handleOpenTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenTerminal && terminalAvailable) {
      onOpenTerminal(node.path);
    }
  };

  return (
    <Box>
      <Box
        data-path={node.path}
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: level * 2,
          py: 0.5,
          minHeight: 32,  // Fixed minimum height for consistent row spacing
          cursor: 'pointer',
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          '&:hover': {
            bgcolor: 'action.hover',
            '& .download-btn': {
              visibility: 'visible'
            },
            '& .terminal-btn': {
              visibility: 'visible'
            }
          },
          borderLeft: diff && diff.status !== 'same' ? `3px solid ${getStatusColor(diff.status)}` : 'none'
        }}
        onClick={handleClick}
      >
        {(node.type === 'directory' || isSymlinkFolder) && (
          <IconButton size="small" sx={{ p: 0, mr: 0.5 }}>
            {expanded ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
          </IconButton>
        )}
        
        {node.type === 'directory' ? (
          expanded ? <FolderOpen fontSize="small" sx={{ mr: 1, color: '#ffa726' }} /> : <Folder fontSize="small" sx={{ mr: 1, color: '#ffa726' }} />
        ) : node.type === 'symlink' ? (
          isSymlinkFolder ? (
            // Symlink to folder - show folder icon with link overlay color
            expanded ? 
              <FolderSpecial fontSize="small" sx={{ mr: 1, color: '#29b6f6' }} /> : 
              <FolderSpecial fontSize="small" sx={{ mr: 1, color: '#29b6f6' }} />
          ) : (
            // Symlink to file
            <Link fontSize="small" sx={{ mr: 1, ml: 2.5, color: '#29b6f6' }} />
          )
        ) : (
          <InsertDriveFile fontSize="small" sx={{ mr: 1, ml: 2.5, color: '#90caf9' }} />
        )}

        <Typography
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            color: diff?.status && diff.status !== 'same' ? getStatusColor(diff.status) : 'inherit',
            fontWeight: diff?.status && diff.status !== 'same' ? 600 : 400,
            minWidth: '200px'
          }}
        >
          {node.name}
          {node.type === 'symlink' && node.linkname && (
            <Typography component="span" sx={{ color: 'text.secondary', fontSize: '0.75rem', ml: 1 }}>
              → {node.linkname}
            </Typography>
          )}
        </Typography>

        {diff && diff.status !== 'same' && getStatusIcon(diff.status)}

        <Tooltip title={`Permissions: ${formatPermissions(node.mode)} (${node.uid}:${node.gid})\nModified: ${formatDate(node.mtime)}`}>
          <Box sx={{ display: 'flex', gap: 2, ml: 'auto', mr: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', minWidth: '90px' }}>
              {formatPermissions(node.mode)} {node.uid}:{node.gid}
            </Typography>
            {node.mtime && (
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: '120px' }}>
                {formatDate(node.mtime)}
              </Typography>
            )}
            {node.size !== undefined && node.type === 'file' && (
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: '70px', textAlign: 'right' }}>
                {(node.size / 1024).toFixed(1)} KB
              </Typography>
            )}
          </Box>
        </Tooltip>

        {node.type === 'file' && (
          <IconButton 
            size="small" 
            className="download-btn"
            onClick={handleDownload}
            sx={{ ml: 1, visibility: 'hidden', p: 0.5 }}
          >
            <Download fontSize="small" />
          </IconButton>
        )}

        {/* Terminal button for folders - requires Docker/Podman */}
        {(node.type === 'directory' || isSymlinkFolder) && terminalAvailable && onOpenTerminal && (
          <Tooltip title="Open terminal in this folder (requires Docker/Podman)">
            <IconButton 
              size="small" 
              className="terminal-btn"
              onClick={handleOpenTerminal}
              sx={{ ml: 1, visibility: 'hidden', p: 0.5, color: '#0dbc79' }}
            >
              <Terminal fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {(node.type === 'directory' || isSymlinkFolder) && Array.isArray(node.children) && node.children.length > 0 && expanded && (
        <Collapse in={expanded} timeout="auto">
          {node.children.map((child, index) => (
            <FileTree
              key={`${child.path}-${index}`}
              node={child}
              onSelect={onSelect}
              selectedPath={selectedPath}
              diffMap={diffMap}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onNavigateToSymlinkTarget={onNavigateToSymlinkTarget}
              imageRef={imageRef}
              level={level + 1}
              onOpenTerminal={onOpenTerminal}
              terminalAvailable={terminalAvailable}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
});

export default FileTree;
