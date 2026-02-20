import { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Chip,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import * as Diff from 'diff';

interface HistoryEntry {
  id: number;
  created: string;
  createdBy: string;
  size: number;
  comment: string;
  emptyLayer: boolean;
  layerDigest?: string;
}

interface ImageHistoryViewProps {
  leftImageRef: string;
  rightImageRef?: string;
  isSingleImageMode?: boolean;
}

export default function ImageHistoryView({
  leftImageRef,
  rightImageRef,
  isSingleImageMode
}: ImageHistoryViewProps) {
  const [leftHistory, setLeftHistory] = useState<HistoryEntry[]>([]);
  const [rightHistory, setRightHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const leftRes = await fetch(`/api/download/history/${encodeURIComponent(leftImageRef)}`);
        if (!leftRes.ok) throw new Error('Failed to fetch left image history');
        const leftData = await leftRes.json();
        setLeftHistory(leftData.history || []);

        if (!isSingleImageMode && rightImageRef) {
          const rightRes = await fetch(`/api/download/history/${encodeURIComponent(rightImageRef)}`);
          if (!rightRes.ok) throw new Error('Failed to fetch right image history');
          const rightData = await rightRes.json();
          setRightHistory(rightData.history || []);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch image history');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [leftImageRef, rightImageRef, isSingleImageMode]);

  // Compute diff between left and right history
  interface HistoryDiffEntry {
    leftEntry: HistoryEntry | null;
    rightEntry: HistoryEntry | null;
    status: 'same' | 'different' | 'left-only' | 'right-only';
    wordDiffs?: Diff.Change[]; // Word-level diffs for 'different' status
  }

  const historyDiff = useMemo((): HistoryDiffEntry[] => {
    if (isSingleImageMode || rightHistory.length === 0) {
      return leftHistory.map(entry => ({ leftEntry: entry, rightEntry: null, status: 'same' as const }));
    }

    const diff: HistoryDiffEntry[] = [];
    const maxLen = Math.max(leftHistory.length, rightHistory.length);

    // Compare histories by index (reverse order - oldest first in array)
    for (let i = 0; i < maxLen; i++) {
      const left = i < leftHistory.length ? leftHistory[i] : null;
      const right = i < rightHistory.length ? rightHistory[i] : null;

      if (left && right) {
        // Compare the createdBy commands (main differentiator)
        const leftCmd = left.createdBy || '';
        const rightCmd = right.createdBy || '';
        const isSame = leftCmd === rightCmd && left.emptyLayer === right.emptyLayer;
        
        // Compute word-level diffs for different entries
        const wordDiffs = isSame ? undefined : Diff.diffWords(leftCmd, rightCmd);
        
        diff.push({
          leftEntry: left,
          rightEntry: right,
          status: isSame ? 'same' : 'different',
          wordDiffs
        });
      } else if (left) {
        diff.push({ leftEntry: left, rightEntry: null, status: 'left-only' });
      } else if (right) {
        diff.push({ leftEntry: null, rightEntry: right, status: 'right-only' });
      }
    }

    return diff;
  }, [leftHistory, rightHistory, isSingleImageMode]);

  // Filter diff entries based on showOnlyDifferences
  const filteredDiff = useMemo(() => {
    if (!showOnlyDifferences) return historyDiff;
    return historyDiff.filter(entry => entry.status !== 'same');
  }, [historyDiff, showOnlyDifferences]);

  // Count differences
  const diffStats = useMemo(() => {
    const stats = { same: 0, different: 0, leftOnly: 0, rightOnly: 0 };
    historyDiff.forEach(entry => {
      if (entry.status === 'same') stats.same++;
      else if (entry.status === 'different') stats.different++;
      else if (entry.status === 'left-only') stats.leftOnly++;
      else if (entry.status === 'right-only') stats.rightOnly++;
    });
    return stats;
  }, [historyDiff]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const formatCreatedBy = (createdBy: string) => {
    if (!createdBy) return '-';
    // Remove the "/bin/sh -c " prefix if present
    let formatted = createdBy.replace(/^\/bin\/sh -c\s+/, '');
    // Remove "#(nop)" prefix
    formatted = formatted.replace(/^#\(nop\)\s+/, '');
    return formatted;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'same': return 'transparent';
      case 'different': return 'rgba(255, 152, 0, 0.1)'; // Orange for modified
      case 'left-only': return 'rgba(244, 67, 54, 0.1)'; // Red for left-only
      case 'right-only': return 'rgba(76, 175, 80, 0.1)'; // Green for right-only
      default: return 'transparent';
    }
  };

  const getStatusChip = (status: string) => {
    const colors: any = {
      'same': 'success',
      'different': 'warning',
      'left-only': 'error',
      'right-only': 'info'
    };
    return <Chip label={status} size="small" color={colors[status] || 'default'} />;
  };

  const renderHistoryTable = (history: HistoryEntry[], title: string) => (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.primary' }}>
        {title}
      </Typography>
      <TableContainer sx={{ maxHeight: 500, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 150 }}>Created</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell sx={{ width: 100 }}>Type</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  <Typography color="text.secondary">No history available</Typography>
                </TableCell>
              </TableRow>
            ) : (
              history.map((entry) => (
                <TableRow 
                  key={entry.id}
                  sx={{ 
                    backgroundColor: entry.emptyLayer ? 'transparent' : 'rgba(25, 118, 210, 0.04)',
                    '&:hover': { backgroundColor: 'action.hover' }
                  }}
                >
                  <TableCell sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {formatDate(entry.created)}
                  </TableCell>
                  <TableCell>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        fontFamily: 'monospace', 
                        fontSize: '0.75rem',
                        wordBreak: 'break-all',
                        maxWidth: 600
                      }}
                    >
                      {formatCreatedBy(entry.createdBy)}
                    </Typography>
                    {entry.layerDigest && (
                      <Typography 
                        variant="caption" 
                        color="text.secondary" 
                        sx={{ 
                          display: 'block', 
                          fontFamily: 'monospace',
                          fontSize: '0.65rem',
                          mt: 0.5
                        }}
                      >
                        Layer: {entry.layerDigest.slice(0, 30)}...
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={entry.emptyLayer ? 'metadata' : 'layer'}
                      size="small"
                      color={entry.emptyLayer ? 'default' : 'primary'}
                      variant={entry.emptyLayer ? 'outlined' : 'filled'}
                      sx={{ fontSize: '0.65rem' }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  // Render single history entry cell content with optional word-level diff highlighting
  const renderEntryCell = (
    entry: HistoryEntry | null, 
    wordDiffs?: Diff.Change[], 
    side?: 'left' | 'right'
  ) => {
    if (!entry) {
      return (
        <Typography color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.75rem' }}>
          -
        </Typography>
      );
    }

    // Render the createdBy text with or without diff highlighting
    const renderCreatedByText = () => {
      const formattedText = formatCreatedBy(entry.createdBy);
      
      // If we have word diffs and a side, apply highlighting
      if (wordDiffs && side) {
        const filteredDiffs = wordDiffs.filter(d => 
          side === 'left' ? !d.added : !d.removed
        );
        
        return (
          <Typography 
            variant="body2" 
            component="span"
            sx={{ 
              fontFamily: 'monospace', 
              fontSize: '0.75rem',
              wordBreak: 'break-all'
            }}
          >
            {filteredDiffs.map((part, idx) => {
              const isChange = side === 'left' ? part.removed : part.added;
              // Format the diff part the same way as the full text
              let text = part.value;
              text = text.replace(/^\/bin\/sh -c\s+/, '');
              text = text.replace(/^#\(nop\)\s+/, '');
              
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: isChange 
                      ? (side === 'left' ? 'rgba(244, 67, 54, 0.35)' : 'rgba(76, 175, 80, 0.35)')
                      : 'transparent',
                    borderRadius: isChange ? '2px' : undefined,
                    padding: isChange ? '0 1px' : undefined
                  }}
                >
                  {text}
                </span>
              );
            })}
          </Typography>
        );
      }

      // No highlighting needed
      return (
        <Typography 
          variant="body2" 
          sx={{ 
            fontFamily: 'monospace', 
            fontSize: '0.75rem',
            wordBreak: 'break-all'
          }}
        >
          {formattedText}
        </Typography>
      );
    };

    return (
      <>
        {renderCreatedByText()}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
            {formatDate(entry.created)}
          </Typography>
          <Chip
            label={entry.emptyLayer ? 'metadata' : 'layer'}
            size="small"
            color={entry.emptyLayer ? 'default' : 'primary'}
            variant={entry.emptyLayer ? 'outlined' : 'filled'}
            sx={{ fontSize: '0.6rem', height: 18 }}
          />
        </Box>
        {entry.layerDigest && (
          <Typography 
            variant="caption" 
            color="text.secondary" 
            sx={{ 
              display: 'block', 
              fontFamily: 'monospace',
              fontSize: '0.6rem'
            }}
          >
            Layer: {entry.layerDigest.slice(0, 24)}...
          </Typography>
        )}
      </>
    );
  };

  // Render diff comparison table
  const renderDiffTable = () => (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={`Same: ${diffStats.same}`} size="small" color="success" variant="outlined" />
          <Chip label={`Different: ${diffStats.different}`} size="small" color="warning" variant="outlined" />
          <Chip label={`Left only: ${diffStats.leftOnly}`} size="small" color="error" variant="outlined" />
          <Chip label={`Right only: ${diffStats.rightOnly}`} size="small" color="info" variant="outlined" />
        </Box>
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
      </Box>
      <TableContainer sx={{ maxHeight: 500, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '5%' }}>#</TableCell>
              <TableCell sx={{ width: '42.5%' }}>Left Image</TableCell>
              <TableCell sx={{ width: '42.5%' }}>Right Image</TableCell>
              <TableCell sx={{ width: '10%' }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDiff.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography color="text.secondary">
                    {showOnlyDifferences ? 'No differences found' : 'No history available'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredDiff.map((diffEntry, index) => (
                <TableRow 
                  key={index}
                  sx={{ 
                    backgroundColor: getStatusColor(diffEntry.status),
                    '&:hover': { backgroundColor: 'action.hover' }
                  }}
                >
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {index + 1}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    {renderEntryCell(diffEntry.leftEntry, diffEntry.wordDiffs, 'left')}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    {renderEntryCell(diffEntry.rightEntry, diffEntry.wordDiffs, 'right')}
                  </TableCell>
                  <TableCell>
                    {getStatusChip(diffEntry.status)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, py: 4 }}>
        <CircularProgress size={24} />
        <Typography>Loading image history...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  if (isSingleImageMode) {
    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom sx={{ mb: 2 }}>
          Image Build History
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Shows the commands and layers that were used to build this image
        </Typography>
        {renderHistoryTable(leftHistory, 'Build History')}
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom sx={{ mb: 2 }}>
        Image Build History Comparison
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Compare the build history of both images showing differences between layers
      </Typography>
      {renderDiffTable()}
    </Box>
  );
}
