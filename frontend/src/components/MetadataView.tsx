import { useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Typography,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Link
} from '@mui/material';
import { ExpandMore, Download } from '@mui/icons-material';
import { MetadataDiff, FileNode } from '../../../shared/types';

interface MetadataViewProps {
  metadata: MetadataDiff;
  leftImageRef?: string;
  rightImageRef?: string;
  isSingleImageMode?: boolean;
  onNavigateToPath?: (path: string) => void;
  fileTree?: FileNode;
  rightFileTree?: FileNode;
}

export default function MetadataView({ 
  metadata, 
  leftImageRef, 
  rightImageRef, 
  isSingleImageMode,
  onNavigateToPath,
  fileTree,
  rightFileTree
}: MetadataViewProps) {
  
  // Build a set of all paths in the file tree for fast lookup
  const validPaths = useMemo(() => {
    const paths = new Set<string>();
    if (!fileTree) return paths;
    
    const collectPaths = (node: FileNode) => {
      paths.add(node.path);
      node.children?.forEach(collectPaths);
    };
    collectPaths(fileTree);
    return paths;
  }, [fileTree]);

  // Build a set of all paths in the RIGHT file tree for fast lookup
  const rightValidPaths = useMemo(() => {
    const paths = new Set<string>();
    const tree = rightFileTree || fileTree; // Fallback to left tree if no right tree
    if (!tree) return paths;
    
    const collectPaths = (node: FileNode) => {
      paths.add(node.path);
      node.children?.forEach(collectPaths);
    };
    collectPaths(tree);
    return paths;
  }, [rightFileTree, fileTree]);

  // Get environment variables as a map for resolving ${VAR} references (LEFT image)
  const leftEnvVars = useMemo(() => {
    const vars = new Map<string, string>();
    metadata.env?.forEach(e => {
      if (e.leftValue) vars.set(e.key, e.leftValue);
    });
    return vars;
  }, [metadata.env]);

  // Get environment variables as a map for resolving ${VAR} references (RIGHT image)
  const rightEnvVars = useMemo(() => {
    const vars = new Map<string, string>();
    metadata.env?.forEach(e => {
      if (e.rightValue) vars.set(e.key, e.rightValue);
    });
    return vars;
  }, [metadata.env]);

  // Get PATH directories for searching scripts without paths (LEFT)
  const leftPathDirs = useMemo(() => {
    const pathValue = leftEnvVars.get('PATH') || '';
    return pathValue.split(':').filter(Boolean);
  }, [leftEnvVars]);

  // Get PATH directories for searching scripts without paths (RIGHT)
  const rightPathDirs = useMemo(() => {
    const pathValue = rightEnvVars.get('PATH') || '';
    return pathValue.split(':').filter(Boolean);
  }, [rightEnvVars]);

  // Resolve environment variables in a path like ${CATALINA_HOME}/bin/catalina.sh
  const resolveEnvVars = useCallback((path: string, useRightTree = false): string => {
    const envMap = useRightTree ? rightEnvVars : leftEnvVars;
    return path.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced;
      return envMap.get(varName) || match;
    });
  }, [leftEnvVars, rightEnvVars]);

  // Check if a path exists in the file tree (left or right)
  const pathExists = useCallback((path: string, useRightTree = false): boolean => {
    if (!path || path === '/') return false;
    return useRightTree ? rightValidPaths.has(path) : validPaths.has(path);
  }, [validPaths, rightValidPaths]);

  // Check if a path is a directory (in left or right tree)
  const isDirectory = useCallback((path: string, useRightTree = false): boolean => {
    const tree = useRightTree ? (rightFileTree || fileTree) : fileTree;
    if (!tree) return false;
    
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
    
    const node = findNode(tree, path);
    // Consider both directories and symlinks that point to directories
    return node?.type === 'directory' || 
           (node?.type === 'symlink' && (node.linkTarget?.endsWith('/') || Array.isArray(node.children)));
  }, [fileTree, rightFileTree]);

  // Check if a path is a symlink (in left or right tree)
  const isSymlink = useCallback((path: string, useRightTree = false): boolean => {
    const tree = useRightTree ? (rightFileTree || fileTree) : fileTree;
    if (!tree) return false;
    
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
    
    const node = findNode(tree, path);
    return node?.type === 'symlink';
  }, [fileTree, rightFileTree]);

  // Check if a path is an empty folder (no children)
  const isEmptyFolder = useCallback((path: string, useRightTree = false): boolean => {
    const tree = useRightTree ? (rightFileTree || fileTree) : fileTree;
    if (!tree) return false;
    
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
    
    const node = findNode(tree, path);
    if (!node) return false;
    // Empty folder is a directory with no children (or empty children array)
    return node.type === 'directory' && (!node.children || node.children.length === 0);
  }, [fileTree, rightFileTree]);

  // Get symlink target for a path
  const getSymlinkTarget = useCallback((path: string, useRightTree = false): string | null => {
    const tree = useRightTree ? (rightFileTree || fileTree) : fileTree;
    if (!tree) return null;
    
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
    
    const node = findNode(tree, path);
    return node?.type === 'symlink' ? (node.linkTarget || null) : null;
  }, [fileTree, rightFileTree]);

  // Search PATH for a script name and return the full path if found
  const findInPath = useCallback((scriptName: string, useRightTree = false): string | null => {
    const dirs = useRightTree ? rightPathDirs : leftPathDirs;
    for (const dir of dirs) {
      const fullPath = `${dir}/${scriptName}`;
      if (pathExists(fullPath, useRightTree)) {
        return fullPath;
      }
    }
    return null;
  }, [leftPathDirs, rightPathDirs, pathExists]);

  // Check if something looks like it could be a filesystem path worth making clickable
  const isLikelyPath = useCallback((text: string, useRightTree = false): { 
    isPath: boolean; 
    resolvedPath: string | null; 
    displayText: string; 
    isFolder: boolean;
    isFolderSymlink: boolean;
    isEmpty: boolean;
    symlinkTarget: string | null;
  } => {
    const defaultReturn = { isPath: false, resolvedPath: null, displayText: text, isFolder: false, isFolderSymlink: false, isEmpty: false, symlinkTarget: null };
    
    // Skip Java package-like patterns (e.g., /java.lang, /com.sun.jndi.toolkit.url)
    // These have dots between lowercase words without file extensions
    if (/^\/[a-z]+(\.[a-z]+)+$/i.test(text) && !text.includes('/')) {
      return defaultReturn;
    }
    
    // Skip patterns that look like Java module options (contain = after the path-like part)
    // e.g., "/java.net=ALL-UNNAMED" is not a path
    
    // Check for environment variable references like ${VAR}/path
    if (text.includes('${') || text.includes('$')) {
      const resolved = resolveEnvVars(text, useRightTree);
      if (resolved !== text && pathExists(resolved, useRightTree)) {
        const folder = isDirectory(resolved, useRightTree);
        const symlink = isSymlink(resolved, useRightTree);
        const empty = isEmptyFolder(resolved, useRightTree);
        const target = getSymlinkTarget(resolved, useRightTree);
        return { isPath: true, resolvedPath: resolved, displayText: text, isFolder: folder || symlink, isFolderSymlink: symlink && folder, isEmpty: empty, symlinkTarget: target };
      }
    }
    
    // Check absolute paths
    if (text.startsWith('/')) {
      // Must have at least 2 path segments to be considered a real path
      const segments = text.split('/').filter(Boolean);
      if (segments.length < 1) {
        return defaultReturn;
      }
      
      // Skip if it looks like a Java package (dots without slashes, except for file extension at end)
      const lastSegment = segments[segments.length - 1];
      const dotsInLast = (lastSegment.match(/\./g) || []).length;
      const hasFileExtension = /\.[a-zA-Z0-9]{1,5}$/.test(lastSegment);
      
      // If multiple dots and no file extension, likely Java package
      if (dotsInLast > 1 && !hasFileExtension) {
        return defaultReturn;
      }
      
      // Verify path exists in filesystem (includes symlinks)
      if (pathExists(text, useRightTree)) {
        const folder = isDirectory(text, useRightTree);
        const symlink = isSymlink(text, useRightTree);
        const empty = isEmptyFolder(text, useRightTree);
        const target = getSymlinkTarget(text, useRightTree);
        return { isPath: true, resolvedPath: text, displayText: text, isFolder: folder, isFolderSymlink: symlink && folder, isEmpty: empty, symlinkTarget: target };
      }
    }
    
    // Check for bare script names (no path) that might be in PATH
    if (!text.includes('/') && (text.endsWith('.sh') || text.endsWith('.py') || text.endsWith('.pl'))) {
      const foundPath = findInPath(text, useRightTree);
      if (foundPath) {
        return { isPath: true, resolvedPath: foundPath, displayText: text, isFolder: false, isFolderSymlink: false, isEmpty: false, symlinkTarget: null };
      }
    }
    
    return defaultReturn;
  }, [resolveEnvVars, pathExists, isDirectory, isSymlink, isEmptyFolder, getSymlinkTarget, findInPath]);

  const getStatusChip = (status: string) => {
    if (isSingleImageMode) return null;
    const colors: any = {
      'same': 'success',
      'different': 'warning',
      'left-only': 'error',
      'right-only': 'info'
    };
    return <Chip label={status} size="small" color={colors[status] || 'default'} />;
  };

  const handleDownloadConfig = (imageRef: string) => {
    window.open(`/api/download/config/${encodeURIComponent(imageRef)}`, '_blank');
  };

  // Render text with smart clickable file paths
  const renderWithClickablePaths = (text: string | undefined, useRightTree = false) => {
    if (!text) return '-';
    
    const parts: (string | JSX.Element)[] = [];
    
    // Pattern to match:
    // 1. Environment variable paths like ${VAR}/path/file or $VAR/path
    // 2. Absolute paths like /path/to/file
    // 3. Bare script names like script.sh
    const pathPattern = /(\$\{[^}]+\}(?:\/[^\s:;=]+)?|\$[A-Z_][A-Z0-9_]*(?:\/[^\s:;=]+)?|\/[^\s:;=]+|[a-zA-Z0-9_-]+\.(?:sh|py|pl|rb|js))/g;
    
    let lastIndex = 0;
    let match;
    
    while ((match = pathPattern.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      
      const potentialPath = match[1];
      const { isPath, resolvedPath, displayText, isFolder, isFolderSymlink, isEmpty, symlinkTarget } = isLikelyPath(potentialPath, useRightTree);
      
      if (isPath && resolvedPath && onNavigateToPath) {
        // Determine link color and style:
        // - Empty folders: red (error.main)
        // - Symlink folders: bold, primary color
        // - Regular: primary color
        const linkColor = isEmpty ? 'error.main' : 'primary.main';
        const fontWeight = isFolderSymlink ? 'bold' : 'normal';
        
        // Build title text
        let title = isFolder ? 'Open folder' : 'View file';
        if (resolvedPath !== displayText) {
          title = `Resolves to: ${resolvedPath}`;
        }
        if (isFolderSymlink && symlinkTarget) {
          title = `Symlink → ${symlinkTarget}`;
        }
        if (isEmpty) {
          title = 'Empty folder';
        }
        
        parts.push(
          <Link
            key={match.index}
            component="button"
            variant="body2"
            sx={{ 
              fontFamily: 'monospace', 
              fontSize: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
              color: linkColor,
              fontWeight: fontWeight
            }}
            onClick={(e) => {
              e.preventDefault();
              // For symlink folders, navigate to the target folder if it exists
              if (isFolderSymlink && symlinkTarget) {
                // Resolve relative symlink target to absolute path
                const targetPath = symlinkTarget.startsWith('/') 
                  ? symlinkTarget 
                  : resolvedPath.substring(0, resolvedPath.lastIndexOf('/') + 1) + symlinkTarget;
                onNavigateToPath(targetPath.replace(/\/$/, '')); // Remove trailing slash
              } else {
                onNavigateToPath(resolvedPath);
              }
            }}
            title={title}
          >
            {displayText}
          </Link>
        );
      } else {
        parts.push(potentialPath);
      }
      
      lastIndex = pathPattern.lastIndex;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    
    return parts.length > 0 ? <>{parts}</> : text;
  };

  // Render command array with clickable paths
  const renderCommandWithPaths = (cmd: string[] | undefined, useRightTree = false) => {
    if (!cmd || cmd.length === 0) return '-';
    const joined = cmd.join(' ');
    return renderWithClickablePaths(joined, useRightTree);
  };

  return (
    <Box>
      {/* Config Download Links */}
      {(leftImageRef || rightImageRef) && (
        <Box sx={{ mb: 2, display: 'flex', justifyContent: isSingleImageMode ? 'flex-start' : 'space-between' }}>
          {leftImageRef && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Download />}
              onClick={() => handleDownloadConfig(leftImageRef)}
            >
              {isSingleImageMode ? 'Download config.json' : 'Download Left config.json'}
            </Button>
          )}
          {rightImageRef && rightImageRef !== leftImageRef && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Download />}
              onClick={() => handleDownloadConfig(rightImageRef)}
            >
              Download Right config.json
            </Button>
          )}
        </Box>
      )}

      {/* Basic Metadata */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Basic Configuration</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Property</TableCell>
                  {isSingleImageMode ? (
                    <TableCell>Value</TableCell>
                  ) : (
                    <>
                      <TableCell>Left Value</TableCell>
                      <TableCell>Right Value</TableCell>
                      <TableCell>Status</TableCell>
                    </>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {metadata.user && (
                  <TableRow>
                    <TableCell>User</TableCell>
                    {isSingleImageMode ? (
                      <TableCell>{metadata.user.left || '-'}</TableCell>
                    ) : (
                      <>
                        <TableCell>{metadata.user.left || '-'}</TableCell>
                        <TableCell>{metadata.user.right || '-'}</TableCell>
                        <TableCell>{getStatusChip(metadata.user.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {metadata.workingDir && (
                  <TableRow>
                    <TableCell>Working Directory</TableCell>
                    {isSingleImageMode ? (
                      <TableCell sx={{ fontFamily: 'monospace' }}>
                        {renderWithClickablePaths(metadata.workingDir.left)}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {renderWithClickablePaths(metadata.workingDir.left)}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {renderWithClickablePaths(metadata.workingDir.right, true)}
                        </TableCell>
                        <TableCell>{getStatusChip(metadata.workingDir.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {metadata.entrypoint && (
                  <TableRow>
                    <TableCell>Entrypoint</TableCell>
                    {isSingleImageMode ? (
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {renderCommandWithPaths(metadata.entrypoint.left)}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                          {renderCommandWithPaths(metadata.entrypoint.left)}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                          {renderCommandWithPaths(metadata.entrypoint.right, true)}
                        </TableCell>
                        <TableCell>{getStatusChip(metadata.entrypoint.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {metadata.cmd && (
                  <TableRow>
                    <TableCell>Command</TableCell>
                    {isSingleImageMode ? (
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {renderCommandWithPaths(metadata.cmd.left)}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                          {renderCommandWithPaths(metadata.cmd.left)}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                          {renderCommandWithPaths(metadata.cmd.right, true)}
                        </TableCell>
                        <TableCell>{getStatusChip(metadata.cmd.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {metadata.architecture && (
                  <TableRow>
                    <TableCell>Architecture</TableCell>
                    {isSingleImageMode ? (
                      <TableCell>{metadata.architecture.left}</TableCell>
                    ) : (
                      <>
                        <TableCell>{metadata.architecture.left}</TableCell>
                        <TableCell>{metadata.architecture.right}</TableCell>
                        <TableCell>{getStatusChip(metadata.architecture.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {metadata.os && (
                  <TableRow>
                    <TableCell>OS</TableCell>
                    {isSingleImageMode ? (
                      <TableCell>{metadata.os.left}</TableCell>
                    ) : (
                      <>
                        <TableCell>{metadata.os.left}</TableCell>
                        <TableCell>{metadata.os.right}</TableCell>
                        <TableCell>{getStatusChip(metadata.os.status)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>

      {/* Environment Variables */}
      {metadata.env && metadata.env.length > 0 && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="h6">
              Environment Variables {!isSingleImageMode && `(${metadata.env.filter(e => e.status !== 'same').length} differences)`}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Variable</TableCell>
                    {isSingleImageMode ? (
                      <TableCell>Value</TableCell>
                    ) : (
                      <>
                        <TableCell>Left Value</TableCell>
                        <TableCell>Right Value</TableCell>
                        <TableCell>Status</TableCell>
                      </>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {metadata.env.map((envVar) => (
                    <TableRow key={envVar.key}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{envVar.key}</TableCell>
                      {isSingleImageMode ? (
                        <TableCell sx={{ 
                          fontFamily: 'monospace', 
                          fontSize: '0.875rem',
                          wordBreak: 'break-word',
                          maxWidth: '600px'
                        }}>
                          {renderWithClickablePaths(envVar.leftValue)}
                        </TableCell>
                      ) : (
                        <>
                          <TableCell sx={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.875rem',
                            wordBreak: 'break-word',
                            maxWidth: '400px'
                          }}>
                            {renderWithClickablePaths(envVar.leftValue)}
                          </TableCell>
                          <TableCell sx={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.875rem',
                            wordBreak: 'break-word',
                            maxWidth: '400px'
                          }}>
                            {renderWithClickablePaths(envVar.rightValue, true)}
                          </TableCell>
                          <TableCell>{getStatusChip(envVar.status)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Labels */}
      {metadata.labels && metadata.labels.length > 0 && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="h6">
              Labels {!isSingleImageMode && `(${metadata.labels.filter(l => l.status !== 'same').length} differences)`}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Label</TableCell>
                    {isSingleImageMode ? (
                      <TableCell>Value</TableCell>
                    ) : (
                      <>
                        <TableCell>Left Value</TableCell>
                        <TableCell>Right Value</TableCell>
                        <TableCell>Status</TableCell>
                      </>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {metadata.labels.map((label) => (
                    <TableRow key={label.key}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{label.key}</TableCell>
                      {isSingleImageMode ? (
                        <TableCell sx={{ 
                          fontFamily: 'monospace', 
                          fontSize: '0.875rem',
                          wordBreak: 'break-word',
                          maxWidth: '600px'
                        }}>
                          {label.leftValue || '-'}
                        </TableCell>
                      ) : (
                        <>
                          <TableCell sx={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.875rem',
                            wordBreak: 'break-word',
                            maxWidth: '400px'
                          }}>
                            {label.leftValue || '-'}
                          </TableCell>
                          <TableCell sx={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.875rem',
                            wordBreak: 'break-word',
                            maxWidth: '400px'
                          }}>
                            {label.rightValue || '-'}
                          </TableCell>
                          <TableCell>{getStatusChip(label.status)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Exposed Ports */}
      {metadata.exposedPorts && metadata.exposedPorts.length > 0 && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="h6">
              Exposed Ports {!isSingleImageMode && `(${metadata.exposedPorts.filter(p => p.status !== 'same').length} differences)`}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {metadata.exposedPorts.map((port) => {
                let label = port.port;
                let color: 'default' | 'success' | 'warning' | 'error' | 'info' = 'default';
                
                if (!isSingleImageMode) {
                  if (port.status === 'same') {
                    color = 'success';
                  } else if (port.status === 'left-only') {
                    label = `${port.port} (left only)`;
                    color = 'error';
                  } else if (port.status === 'right-only') {
                    label = `${port.port} (right only)`;
                    color = 'info';
                  } else {
                    color = 'warning';
                  }
                }
                
                return (
                  <Chip
                    key={port.port}
                    label={label}
                    color={color}
                  />
                );
              })}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
