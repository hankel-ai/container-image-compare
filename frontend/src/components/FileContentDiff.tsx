import { useEffect, useState, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Grid,
  FormControlLabel,
  Checkbox,
  TextField,
  InputAdornment,
  IconButton
} from '@mui/material';
import { Search, Clear, KeyboardArrowUp, KeyboardArrowDown } from '@mui/icons-material';
import * as Diff from 'diff';

interface FileContentDiffProps {
  leftImageRef: string;
  rightImageRef: string;
  filePath: string;
  onLoadingChange?: (loading: boolean) => void;
  isSingleImageMode?: boolean;
}

export default function FileContentDiff({
  leftImageRef,
  rightImageRef,
  filePath,
  onLoadingChange,
  isSingleImageMode
}: FileContentDiffProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leftContent, setLeftContent] = useState<string>('');
  const [rightContent, setRightContent] = useState<string>('');
  const [isBinary, setIsBinary] = useState(false);
  const [leftBinary, setLeftBinary] = useState(false);
  const [rightBinary, setRightBinary] = useState(false);
  const [leftMissing, setLeftMissing] = useState(false);
  const [rightMissing, setRightMissing] = useState(false);
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeSearchText, setActiveSearchText] = useState(''); // Only updated on Enter
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState({ left: 0, right: 0, total: 0 });
  
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingSynced = useRef(false);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);
  const matchCounterRef = useRef(0);

  // Check if content appears to be binary
  const detectBinary = (content: string): boolean => {
    // Check for null bytes or excessive non-printable characters
    const nullByteIndex = content.indexOf('\0');
    if (nullByteIndex !== -1 && nullByteIndex < 8000) return true;
    
    // Sample first 8000 chars
    const sample = content.substring(0, 8000);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      // Count non-printable chars (excluding common whitespace)
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintable++;
      }
    }
    // If more than 30% non-printable, consider it binary
    return (nonPrintable / sample.length) > 0.3;
  };

  useEffect(() => {
    const fetchContents = async () => {
      setLoading(true);
      onLoadingChange?.(true);
      setError(null);
      // Reset ALL state at the start of each fetch
      setIsBinary(false);
      setLeftBinary(false);
      setRightBinary(false);
      setLeftMissing(false);
      setRightMissing(false);
      setLeftContent('');
      setRightContent('');

      // Track binary status locally to avoid stale closure issues
      let isLeftBinary = false;
      let isRightBinary = false;

      try {
        const [leftResponse, rightResponse] = await Promise.all([
          fetch(`/api/download/content/${encodeURIComponent(leftImageRef)}/${filePath}`),
          fetch(`/api/download/content/${encodeURIComponent(rightImageRef)}/${filePath}`)
        ]);

        let leftText = '';
        let rightText = '';

        if (leftResponse.ok) {
          const leftData = await leftResponse.json();
          leftText = leftData.content;
          // Check if left content is binary
          if (detectBinary(leftText)) {
            isLeftBinary = true;
            setLeftBinary(true);
          }
        } else if (leftResponse.status === 404) {
          setLeftMissing(true);
          leftText = '';
        } else {
          const leftError = await leftResponse.json();
          if (leftError.error === 'Binary File') {
            isLeftBinary = true;
            setLeftBinary(true);
          } else {
            throw new Error(`Left file: ${leftError.message}`);
          }
        }

        if (rightResponse.ok) {
          const rightData = await rightResponse.json();
          rightText = rightData.content;
          // Check if right content is binary
          if (detectBinary(rightText)) {
            isRightBinary = true;
            setRightBinary(true);
          }
        } else if (rightResponse.status === 404) {
          setRightMissing(true);
          rightText = '';
        } else {
          const rightError = await rightResponse.json();
          if (rightError.error === 'Binary File') {
            isRightBinary = true;
            setRightBinary(true);
          } else {
            throw new Error(`Right file: ${rightError.message}`);
          }
        }

        // Set binary flag if either side is binary (use local vars to avoid stale state)
        if (isLeftBinary || isRightBinary) {
          setIsBinary(true);
        }

        setLeftContent(leftText);
        setRightContent(rightText);
      } catch (err: any) {
        setError(err.message || 'Failed to load file contents');
      } finally {
        setLoading(false);
        onLoadingChange?.(false);
      }
    };

    if (filePath) {
      fetchContents();
    }
  }, [leftImageRef, rightImageRef, filePath, onLoadingChange]);

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
      targetElement.scrollLeft = sourceElement.scrollLeft;
    }
  };

  // Count matches when activeSearchText changes - MUST be before any early returns to follow React hooks rules
  // When showOnlyDifferences is true, only count matches in visible (different) lines
  useEffect(() => {
    // Reset match counter for highlighting
    matchCounterRef.current = 0;
    
    if (!activeSearchText) {
      setTotalMatches({ left: 0, right: 0, total: 0 });
      setCurrentMatchIndex(0);
      matchRefs.current = [];
      return;
    }
    
    try {
      const regex = new RegExp(activeSearchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      
      // When showOnlyDifferences is enabled in comparison mode, we need to filter the content
      // to only search within visible (diff) lines
      if (showOnlyDifferences && !isSingleImageMode) {
        // Compute the diff to get only the visible content
        const diffs = Diff.diffLines(leftContent, rightContent);
        let leftDiffContent = '';
        let rightDiffContent = '';
        
        let i = 0;
        while (i < diffs.length) {
          const part = diffs[i];
          if (part.removed && i + 1 < diffs.length && diffs[i + 1].added) {
            // Modified - include both
            leftDiffContent += part.value;
            rightDiffContent += diffs[i + 1].value;
            i += 2;
          } else if (part.added) {
            rightDiffContent += part.value;
            i++;
          } else if (part.removed) {
            leftDiffContent += part.value;
            i++;
          } else {
            // Unchanged - skip in showOnlyDifferences mode
            i++;
          }
        }
        
        const leftMatches = leftDiffContent.match(regex);
        const rightMatches = rightDiffContent.match(regex);
        const leftCount = leftMatches ? leftMatches.length : 0;
        const rightCount = rightMatches ? rightMatches.length : 0;
        const total = leftCount + rightCount;
        setTotalMatches({ left: leftCount, right: rightCount, total });
        setCurrentMatchIndex(total > 0 ? 1 : 0);
        matchRefs.current = new Array(total).fill(null);
      } else {
        // Normal search across all content
        const leftMatches = leftContent.match(regex);
        const rightMatches = isSingleImageMode ? [] : rightContent.match(regex);
        const leftCount = leftMatches ? leftMatches.length : 0;
        const rightCount = rightMatches ? rightMatches.length : 0;
        const total = leftCount + rightCount;
        setTotalMatches({ left: leftCount, right: rightCount, total });
        setCurrentMatchIndex(total > 0 ? 1 : 0);
        matchRefs.current = new Array(total).fill(null);
      }
    } catch {
      setTotalMatches({ left: 0, right: 0, total: 0 });
      setCurrentMatchIndex(0);
      matchRefs.current = [];
    }
  }, [activeSearchText, leftContent, rightContent, isSingleImageMode, showOnlyDifferences]);

  // Scroll to current match when index changes
  useEffect(() => {
    if (currentMatchIndex > 0 && matchRefs.current[currentMatchIndex - 1]) {
      const matchElement = matchRefs.current[currentMatchIndex - 1];
      if (!matchElement) return;
      
      // Find the scrollable container (the Box with overflow: auto)
      let scrollContainer: HTMLElement | null = matchElement.parentElement;
      while (scrollContainer) {
        const style = window.getComputedStyle(scrollContainer);
        const hasVerticalScroll = (style.overflowY === 'auto' || style.overflowY === 'scroll') && 
            scrollContainer.scrollHeight > scrollContainer.clientHeight;
        const hasHorizontalScroll = (style.overflowX === 'auto' || style.overflowX === 'scroll') && 
            scrollContainer.scrollWidth > scrollContainer.clientWidth;
        if (hasVerticalScroll || hasHorizontalScroll) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }
      
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const matchRect = matchElement.getBoundingClientRect();
        
        // Calculate vertical scroll position (center the match vertically)
        const matchOffsetY = matchRect.top - containerRect.top + scrollContainer.scrollTop;
        const targetScrollY = matchOffsetY - containerRect.height / 2 + matchRect.height / 2;
        
        // Calculate horizontal scroll position (ensure match is visible with some padding)
        const matchOffsetX = matchRect.left - containerRect.left + scrollContainer.scrollLeft;
        const matchRightEdge = matchOffsetX + matchRect.width;
        const visibleRight = scrollContainer.scrollLeft + containerRect.width;
        
        let targetScrollX = scrollContainer.scrollLeft;
        
        // If match is to the right of visible area, scroll right
        if (matchRightEdge > visibleRight - 50) {
          // Scroll to show match with some padding on the left
          targetScrollX = matchOffsetX - 100;
        }
        // If match is to the left of visible area, scroll left
        else if (matchOffsetX < scrollContainer.scrollLeft + 50) {
          targetScrollX = matchOffsetX - 100;
        }
        
        scrollContainer.scrollTo({
          top: Math.max(0, targetScrollY),
          left: Math.max(0, targetScrollX),
          behavior: 'smooth'
        });
      } else {
        // Fallback to scrollIntoView if no container found
        matchElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }, [currentMatchIndex]);

  const navigateToMatch = (direction: 'prev' | 'next') => {
    if (totalMatches.total === 0) return;
    if (direction === 'next') {
      setCurrentMatchIndex(prev => prev >= totalMatches.total ? 1 : prev + 1);
    } else {
      setCurrentMatchIndex(prev => prev <= 1 ? totalMatches.total : prev - 1);
    }
  };

  // Trigger search when Enter is pressed
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSearchText === searchText) {
        // If search text hasn't changed, navigate to next/prev match
        navigateToMatch(e.shiftKey ? 'prev' : 'next');
      } else {
        // New search text, trigger search
        setActiveSearchText(searchText);
      }
    }
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3, mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={24} />
          <Typography>Loading file contents...</Typography>
        </Box>
      </Paper>
    );
  }

  // Debug logging
  console.log('FileContentDiff render state:', { 
    loading, 
    error, 
    isBinary, 
    leftBinary, 
    rightBinary, 
    isSingleImageMode,
    leftContentLength: leftContent.length,
    rightContentLength: rightContent.length
  });

  if (error) {
    return (
      <Paper sx={{ p: 2, mt: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  if (isBinary || leftBinary || rightBinary) {
    return (
      <Paper sx={{ p: 3, mt: 2 }}>
        <Alert severity="info">
          <Typography variant="subtitle2" gutterBottom>Binary File</Typography>
          <Typography variant="body2">
            This file appears to be a binary file and cannot be displayed as text.
            {leftBinary && !rightBinary && ' (Left side is binary)'}
            {!leftBinary && rightBinary && ' (Right side is binary)'}
            {leftBinary && rightBinary && ' (Both sides are binary)'}
          </Typography>
          <Typography variant="caption" sx={{ mt: 1, display: 'block', fontFamily: 'monospace' }}>
            {filePath}
          </Typography>
        </Alert>
      </Paper>
    );
  }

  // Reset match counter at the start of each render so highlighting indices stay in sync
  matchCounterRef.current = 0;

  const renderSideBySide = () => {
    // For very large files, limit the diff computation
    const MAX_DIFF_SIZE = 500000; // 500KB worth of characters
    const leftSize = leftContent.length;
    const rightSize = rightContent.length;
    const isTooLarge = leftSize > MAX_DIFF_SIZE || rightSize > MAX_DIFF_SIZE;

    if (isTooLarge) {
      // For large files, show side-by-side without diff highlighting
      const leftLines = leftContent.split('\n');
      const rightLines = rightContent.split('\n');

      return (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              File is too large for automatic diff highlighting ({(Math.max(leftSize, rightSize) / 1024).toFixed(1)} KB). 
              Showing raw content side-by-side.
            </Alert>
          </Grid>
          <Grid item xs={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
                Left Image {leftMissing && '(File Missing)'}
              </Typography>
              <Box
                ref={leftScrollRef}
                onScroll={handleScroll('left')}
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  lineHeight: 1.8,
                  maxHeight: '500px',
                  overflowY: 'auto',
                  overflowX: 'auto',
                  backgroundColor: '#f6f8fa',
                  p: 2,
                  borderRadius: 1
                }}
              >
                {leftLines.map((line, index) => (
                  <Box key={index} sx={{ display: 'flex' }}>
                    <Typography
                      component="span"
                      sx={{
                        color: '#6a737d',
                        userSelect: 'none',
                        mr: 2,
                        minWidth: '50px',
                        textAlign: 'right',
                        flexShrink: 0
                      }}
                    >
                      {index + 1}
                    </Typography>
                    <Typography component="span" sx={{ whiteSpace: 'pre', wordBreak: 'break-all' }}>
                      {line || ' '}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
                Right Image {rightMissing && '(File Missing)'}
              </Typography>
              <Box
                ref={rightScrollRef}
                onScroll={handleScroll('right')}
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  lineHeight: 1.8,
                  maxHeight: '500px',
                  overflowY: 'auto',
                  overflowX: 'auto',
                  backgroundColor: '#f6f8fa',
                  p: 2,
                  borderRadius: 1
                }}
              >
                {rightLines.map((line, index) => (
                  <Box key={index} sx={{ display: 'flex' }}>
                    <Typography
                      component="span"
                      sx={{
                        color: '#6a737d',
                        userSelect: 'none',
                        mr: 2,
                        minWidth: '50px',
                        textAlign: 'right',
                        flexShrink: 0
                      }}
                    >
                      {index + 1}
                    </Typography>
                    <Typography component="span" sx={{ whiteSpace: 'pre', wordBreak: 'break-all' }}>
                      {line || ' '}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      );
    }

    // Use diff library to compute line-by-line differences
    const diffs = Diff.diffLines(leftContent, rightContent);
    
    interface LineInfo {
      content: string;
      type: 'added' | 'removed' | 'modified' | 'unchanged';
      lineNum: number | null;
      wordDiffs?: Diff.Change[];  // For highlighting specific changes within a line
    }
    
    const leftLines: LineInfo[] = [];
    const rightLines: LineInfo[] = [];
    let leftLineNum = 1;
    let rightLineNum = 1;

    // Process diffs - look for adjacent removed/added pairs (modifications)
    let i = 0;
    while (i < diffs.length) {
      const part = diffs[i];
      const lines = part.value.split('\n');
      // Remove last empty line if exists (from split)
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }

      if (part.removed && i + 1 < diffs.length && diffs[i + 1].added) {
        // This is a modification: removed followed by added
        const addedPart = diffs[i + 1];
        const addedLines = addedPart.value.split('\n');
        if (addedLines[addedLines.length - 1] === '') {
          addedLines.pop();
        }

        // Match up lines as modifications (side-by-side without blank padding)
        const maxLines = Math.max(lines.length, addedLines.length);
        for (let j = 0; j < maxLines; j++) {
          const leftLine = j < lines.length ? lines[j] : null;
          const rightLine = j < addedLines.length ? addedLines[j] : null;

          if (leftLine !== null && rightLine !== null) {
            // Both sides have content - compute word-level diff for highlighting
            const wordDiffs = Diff.diffWords(leftLine, rightLine);
            leftLines.push({ 
              content: leftLine, 
              type: 'modified', 
              lineNum: leftLineNum++,
              wordDiffs: wordDiffs.filter(d => !d.added)  // Left side: removed + unchanged
            });
            rightLines.push({ 
              content: rightLine, 
              type: 'modified', 
              lineNum: rightLineNum++,
              wordDiffs: wordDiffs.filter(d => !d.removed)  // Right side: added + unchanged
            });
          } else if (leftLine !== null) {
            // Only left side - removed line
            leftLines.push({ content: leftLine, type: 'removed', lineNum: leftLineNum++ });
            rightLines.push({ content: '', type: 'unchanged', lineNum: null });
          } else if (rightLine !== null) {
            // Only right side - added line
            leftLines.push({ content: '', type: 'unchanged', lineNum: null });
            rightLines.push({ content: rightLine, type: 'added', lineNum: rightLineNum++ });
          }
        }
        i += 2; // Skip both removed and added parts
      } else if (part.added) {
        // Lines only in right (pure addition, not a modification)
        lines.forEach(line => {
          rightLines.push({ content: line, type: 'added', lineNum: rightLineNum++ });
          leftLines.push({ content: '', type: 'unchanged', lineNum: null });
        });
        i++;
      } else if (part.removed) {
        // Lines only in left (pure removal, not followed by addition)
        lines.forEach(line => {
          leftLines.push({ content: line, type: 'removed', lineNum: leftLineNum++ });
          rightLines.push({ content: '', type: 'unchanged', lineNum: null });
        });
        i++;
      } else {
        // Unchanged lines
        lines.forEach(line => {
          leftLines.push({ content: line, type: 'unchanged', lineNum: leftLineNum++ });
          rightLines.push({ content: line, type: 'unchanged', lineNum: rightLineNum++ });
        });
        i++;
      }
    }

    const getBackgroundColor = (type: string) => {
      switch (type) {
        case 'added': return 'rgba(76, 175, 80, 0.15)'; // Light green
        case 'removed': return 'rgba(244, 67, 54, 0.15)'; // Light red
        case 'modified': return 'rgba(255, 152, 0, 0.1)'; // Light orange for modified
        default: return 'transparent';
      }
    };

    const getBorderColor = (type: string) => {
      switch (type) {
        case 'added': return '#4caf50';
        case 'removed': return '#f44336';
        case 'modified': return '#ff9800';
        default: return 'transparent';
      }
    };

    // Apply search highlighting to text with ref tracking for navigation
    const applySearchHighlight = (text: string): React.ReactNode => {
      if (!activeSearchText || !text) return text;
      
      try {
        const escapedSearch = activeSearchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedSearch})`, 'gi');
        const parts = text.split(regex);
        
        if (parts.length === 1) return text;
        
        // Compare case-insensitively to determine if part is a match
        const searchLower = activeSearchText.toLowerCase();
        
        return parts.map((part, i) => {
          if (part.toLowerCase() === searchLower) {
            const matchIdx = matchCounterRef.current++;
            const isCurrentMatch = matchIdx === currentMatchIndex - 1;
            return (
              <span 
                key={i}
                ref={(el) => { matchRefs.current[matchIdx] = el; }}
                style={{ 
                  backgroundColor: isCurrentMatch ? '#ff9800' : '#fff59d', 
                  padding: '0 2px',
                  borderRadius: '2px',
                  outline: isCurrentMatch ? '2px solid #e65100' : 'none'
                }}
              >
                {part}
              </span>
            );
          }
          return part;
        });
      } catch {
        return text;
      }
    };

    // Render line content with word-level highlighting for modified lines
    const renderLineContent = (line: LineInfo, side: 'left' | 'right') => {
      if (line.type === 'modified' && line.wordDiffs && line.wordDiffs.length > 0) {
        return (
          <Typography component="span" sx={{ whiteSpace: 'pre', wordBreak: 'break-all' }}>
            {line.wordDiffs.map((part, idx) => {
              const isChange = side === 'left' ? part.removed : part.added;
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: isChange 
                      ? (side === 'left' ? 'rgba(244, 67, 54, 0.35)' : 'rgba(76, 175, 80, 0.35)')
                      : 'transparent',
                    borderRadius: isChange ? '2px' : undefined
                  }}
                >
                  {applySearchHighlight(part.value)}
                </span>
              );
            })}
          </Typography>
        );
      }
      return (
        <Typography component="span" sx={{ whiteSpace: 'pre', wordBreak: 'break-all' }}>
          {applySearchHighlight(line.content || ' ')}
        </Typography>
      );
    };

    return (
      <Grid container spacing={2}>
        <Grid item xs={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
              Left Image {leftMissing && '(File Missing)'}
            </Typography>
            <Box
              ref={leftScrollRef}
              onScroll={handleScroll('left')}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                lineHeight: 1.8,
                maxHeight: '500px',
                overflowY: 'auto',
                overflowX: 'auto',
                backgroundColor: '#f6f8fa',
                p: 2,
                borderRadius: 1
              }}
            >
              {leftMissing ? (
                <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  File not found in left image
                </Typography>
              ) : (
                <Box sx={{ minWidth: 'fit-content' }}>
                {leftLines
                  .filter(line => !showOnlyDifferences || line.type !== 'unchanged')
                  .map((line, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      backgroundColor: getBackgroundColor(line.type),
                      borderLeft: `3px solid ${getBorderColor(line.type)}`,
                      pl: 1,
                      minHeight: '1.8em',
                      '&:hover': { backgroundColor: line.type === 'unchanged' ? 'rgba(0, 0, 0, 0.03)' : undefined }
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        color: '#6a737d',
                        userSelect: 'none',
                        mr: 2,
                        minWidth: '50px',
                        textAlign: 'right',
                        flexShrink: 0
                      }}
                    >
                      {line.lineNum || ''}
                    </Typography>
                    {renderLineContent(line, 'left')}
                  </Box>
                ))}
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
              Right Image {rightMissing && '(File Missing)'}
            </Typography>
            <Box
              ref={rightScrollRef}
              onScroll={handleScroll('right')}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                lineHeight: 1.8,
                maxHeight: '500px',
                overflowY: 'auto',
                overflowX: 'auto',
                backgroundColor: '#f6f8fa',
                p: 2,
                borderRadius: 1
              }}
            >
              {rightMissing ? (
                <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  File not found in right image
                </Typography>
              ) : (
                <Box sx={{ minWidth: 'fit-content' }}>
                {rightLines
                  .filter(line => !showOnlyDifferences || line.type !== 'unchanged')
                  .map((line, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      backgroundColor: getBackgroundColor(line.type),
                      borderLeft: `3px solid ${getBorderColor(line.type)}`,
                      pl: 1,
                      minHeight: '1.8em',
                      '&:hover': { backgroundColor: line.type === 'unchanged' ? 'rgba(0, 0, 0, 0.03)' : undefined }
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        color: '#6a737d',
                        userSelect: 'none',
                        mr: 2,
                        minWidth: '50px',
                        textAlign: 'right',
                        flexShrink: 0
                      }}
                    >
                      {line.lineNum || ''}
                    </Typography>
                    {renderLineContent(line, 'right')}
                  </Box>
                ))}
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    );
  };

  // Single file view (for single image mode)
  const renderSingleFile = () => {
    const lines = leftContent.split('\n');
    console.log('renderSingleFile called, lines:', lines.length, 'leftContent length:', leftContent.length);

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
          File Content ({lines.length} lines)
        </Typography>
        <Box
          ref={leftScrollRef}
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            lineHeight: 1.8,
            maxHeight: '500px',
            overflowY: 'auto',
            overflowX: 'auto',
            backgroundColor: '#f6f8fa',
            p: 2,
            borderRadius: 1
          }}
        >
          {lines.map((line, index) => (
            <Box key={index} sx={{ display: 'flex' }} data-line-index={index}>
              <Typography
                component="span"
                sx={{
                  color: '#6a737d',
                  userSelect: 'none',
                  mr: 2,
                  minWidth: '50px',
                  textAlign: 'right',
                  flexShrink: 0
                }}
              >
                {index + 1}
              </Typography>
              <Typography component="span" sx={{ whiteSpace: 'pre', wordBreak: 'break-all' }}>
                {highlightSearchText(line || ' ', activeSearchText)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    );
  };

  // Highlight search text in content with ref tracking for navigation
  const highlightSearchText = (text: string, search: string) => {
    if (!search || !text) return text;
    
    try {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedSearch})`, 'gi');
      const parts = text.split(regex);
      
      if (parts.length === 1) return text;
      
      // Compare case-insensitively to determine if part is a match
      const searchLower = search.toLowerCase();
      
      return parts.map((part, i) => {
        if (part.toLowerCase() === searchLower) {
          const matchIdx = matchCounterRef.current++;
          const isCurrentMatch = matchIdx === currentMatchIndex - 1;
          return (
            <span 
              key={i}
              ref={(el) => { matchRefs.current[matchIdx] = el; }}
              style={{ 
                backgroundColor: isCurrentMatch ? '#ff9800' : '#fff59d', 
                padding: '0 2px',
                borderRadius: '2px',
                outline: isCurrentMatch ? '2px solid #e65100' : 'none'
              }}
            >
              {part}
            </span>
          );
        }
        return part;
      });
    } catch {
      return text;
    }
  };

  // Format match count display - show separate counts for left/right in comparison mode
  // Only show count if a search has been executed (activeSearchText is set)
  const formatMatchCount = () => {
    if (!activeSearchText) return null; // Don't show count until search is executed
    if (totalMatches.total === 0) return '0';
    if (isSingleImageMode) {
      return `${currentMatchIndex}/${totalMatches.total}`;
    }
    return `${currentMatchIndex}/${totalMatches.total} (L:${totalMatches.left} R:${totalMatches.right})`;
  };

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      {/* Header with file path */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          {isSingleImageMode ? 'File Content' : 'File Content Comparison'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {filePath}
        </Typography>
      </Box>
      
      {/* Centered search bar spanning both columns */}
      <Box sx={{ 
        mb: 2, 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        gap: 2,
        flexWrap: 'wrap'
      }}>
        {/* Search input - centered */}
        <TextField
          size="small"
          placeholder="Search in file (press Enter)..."
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            // Clear highlights immediately when typing new search
            if (activeSearchText) {
              setActiveSearchText('');
            }
          }}
          sx={{ width: 350 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (searchText || activeSearchText) && (
              <InputAdornment position="end">
                {formatMatchCount() !== null && (
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, whiteSpace: 'nowrap' }}>
                    {formatMatchCount()}
                  </Typography>
                )}
                <IconButton 
                  size="small" 
                  onClick={() => navigateToMatch('prev')}
                  disabled={totalMatches.total === 0}
                  title="Previous match (Shift+Enter)"
                >
                  <KeyboardArrowUp fontSize="small" />
                </IconButton>
                <IconButton 
                  size="small" 
                  onClick={() => navigateToMatch('next')}
                  disabled={totalMatches.total === 0}
                  title="Next match (Enter)"
                >
                  <KeyboardArrowDown fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => { setSearchText(''); setActiveSearchText(''); }}>
                  <Clear fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          onKeyDown={handleSearchKeyDown}
        />
        {!isSingleImageMode && (
          <FormControlLabel
            control={
              <Checkbox
                checked={showOnlyDifferences}
                onChange={(e) => setShowOnlyDifferences(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">Show only differences</Typography>}
          />
        )}
      </Box>
      {(() => {
        try {
          return isSingleImageMode ? renderSingleFile() : renderSideBySide();
        } catch (err) {
          console.error('Error rendering content:', err);
          return <Alert severity="error">Error rendering content: {String(err)}</Alert>;
        }
      })()}
    </Paper>
  );
}
