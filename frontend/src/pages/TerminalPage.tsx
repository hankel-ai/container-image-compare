/**
 * Terminal Page - Dedicated browser tab for container terminal
 * 
 * This page opens in a new browser tab and provides a full-screen terminal
 * experience for interacting with containers.
 * 
 * URL: /terminal/:encodedImageRef
 * The imageRef is base64 encoded in the URL to handle special characters
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box, Typography, IconButton, CircularProgress, Alert, Tooltip, AppBar, Toolbar } from '@mui/material';
import { Terminal as TerminalIcon, Refresh, ContentCopy, Check } from '@mui/icons-material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useContainerTerminalStore } from '../store/containerTerminal';

// Decode base64 image ref from URL
function decodeImageRef(encoded: string): string {
  try {
    return atob(decodeURIComponent(encoded));
  } catch {
    return encoded;
  }
}

// Extract short name (repository:tag) from full image reference
// e.g., "artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0" -> "dctm-tomcat:23.4.0"
function getShortImageName(imageRef: string): string {
  // Remove registry/path prefix, keep only the last part (repo:tag)
  const parts = imageRef.split('/');
  return parts[parts.length - 1] || imageRef;
}

export default function TerminalPage() {
  const { encodedImageRef } = useParams<{ encodedImageRef: string }>();
  const [searchParams] = useSearchParams();
  
  const imageRef = encodedImageRef ? decodeImageRef(encodedImageRef) : '';
  // Only set initialWorkingDir if explicitly provided in URL (from Filesystem tab)
  const initialWorkingDir = searchParams.get('dir') || undefined;
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const lastWorkingDir = useRef<string | undefined>(initialWorkingDir);
  
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState('Initializing terminal...');
  const [copied, setCopied] = useState(false);

  const {
    currentSession,
    sessionLoading,
    sessionError,
    runtimeInfo,
    createSession,
    terminateSession,
    fetchRuntimeStatus,
    pendingDirectoryChange,
    clearPendingDirectoryChange
  } = useContainerTerminalStore();

  // Set document title
  useEffect(() => {
    if (imageRef) {
      document.title = `🖥️ ${getShortImageName(imageRef)}`;
    }
    return () => {
      document.title = 'Container Image Compare';
    };
  }, [imageRef]);

  // Update status message when session error changes (for download waiting)
  useEffect(() => {
    if (sessionLoading && sessionError) {
      // Show the waiting message while still loading
      setStatusMessage(sessionError);
    }
  }, [sessionError, sessionLoading]);

  // Fetch runtime status if not available
  useEffect(() => {
    if (!runtimeInfo) {
      fetchRuntimeStatus();
    }
  }, [runtimeInfo, fetchRuntimeStatus]);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || terminalInstance.current) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;

    const initTerminal = () => {
      if (!terminalRef.current) return false;
      
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        scrollback: 5000,
        fastScrollModifier: 'alt',
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0, // Disable smooth scrolling for faster response
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          cursorAccent: '#1e1e1e',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff'
        }
      });

      fitAddon.current = new FitAddon();
      terminal.loadAddon(fitAddon.current);
      terminal.loadAddon(new WebLinksAddon());

      try {
        terminal.open(terminalRef.current);
      } catch (err) {
        console.error('[TerminalPage] terminal.open() error:', err);
        return false;
      }

      requestAnimationFrame(() => {
        fitAddon.current?.fit();
        // Focus terminal immediately
        terminal.focus();
      });

      terminalInstance.current = terminal;
      return true;
    };

    if (!initTerminal()) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            if (initTerminal()) {
              resizeObserver?.disconnect();
            }
          }
        }
      });
      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }
    }

    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN && terminalInstance.current) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: terminalInstance.current.cols,
            rows: terminalInstance.current.rows
          }));
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
        terminalInstance.current = null;
      }
    };
  }, []);

  // Create session when component mounts
  useEffect(() => {
    if (!runtimeInfo?.available || !imageRef) {
      if (runtimeInfo && !runtimeInfo.available) {
        setConnectionStatus('error');
        setStatusMessage('Container runtime not available. Install Docker or Podman.');
      }
      return;
    }

    const initSession = async () => {
      setConnectionStatus('connecting');
      setStatusMessage('Creating container session...');
      
      const session = await createSession(imageRef, initialWorkingDir);
      if (!session) {
        setConnectionStatus('error');
        // Use the session error from the store if available (includes waiting message)
        const errorMsg = useContainerTerminalStore.getState().sessionError;
        setStatusMessage(errorMsg || 'Failed to create container session');
      }
    };

    initSession();

    return () => {
      terminateSession();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [imageRef, runtimeInfo?.available]);

  // Connect WebSocket when session is ready
  useEffect(() => {
    if (!currentSession || currentSession.status !== 'running' || !terminalInstance.current) {
      return;
    }

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentSession?.sessionId, currentSession?.status]);

  // Handle pending directory change from other tabs
  useEffect(() => {
    if (pendingDirectoryChange && 
        pendingDirectoryChange.imageRef === imageRef &&
        wsRef.current?.readyState === WebSocket.OPEN) {
      const newDir = pendingDirectoryChange.path;
      
      // Send cd command to terminal
      if (newDir !== lastWorkingDir.current) {
        const cdCommand = `cd ${newDir}\n`;
        wsRef.current.send(JSON.stringify({ type: 'input', data: cdCommand }));
        lastWorkingDir.current = newDir;
        
        // Focus the terminal
        terminalInstance.current?.focus();
      }
      
      clearPendingDirectoryChange();
    }
  }, [pendingDirectoryChange, imageRef, clearPendingDirectoryChange]);

  // Listen for cross-tab directory change requests via localStorage
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'terminal-cd-request' && e.newValue) {
        try {
          const request = JSON.parse(e.newValue);
          if (request.imageRef === imageRef && 
              wsRef.current?.readyState === WebSocket.OPEN &&
              request.path !== lastWorkingDir.current) {
            const cdCommand = `cd ${request.path}\n`;
            wsRef.current.send(JSON.stringify({ type: 'input', data: cdCommand }));
            lastWorkingDir.current = request.path;
            terminalInstance.current?.focus();
          }
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [imageRef]);

  // Focus terminal on window focus
  useEffect(() => {
    const handleFocus = () => {
      terminalInstance.current?.focus();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!currentSession || wsRef.current) return;

    const terminal = terminalInstance.current;
    if (!terminal) return;

    setConnectionStatus('connecting');
    setStatusMessage('Connecting to container...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?sessionId=${currentSession.sessionId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      setStatusMessage('Connected');
      reconnectAttempts.current = 0;

      terminal.writeln('\x1b[32m*** Connected to container terminal ***\x1b[0m');
      terminal.writeln(`\x1b[90mImage: ${imageRef}\x1b[0m`);
      if (initialWorkingDir) {
        terminal.writeln(`\x1b[90mWorking directory: ${initialWorkingDir}\x1b[0m`);
      }
      terminal.writeln('');

      ws.send(JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows
      }));

      // Focus terminal after connection
      setTimeout(() => terminal.focus(), 100);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'output':
            terminal.write(msg.data);
            break;
          case 'exit':
            terminal.writeln('');
            terminal.writeln(`\x1b[33m*** Container process exited (code: ${msg.code}) ***\x1b[0m`);
            setConnectionStatus('disconnected');
            setStatusMessage('Container exited');
            break;
          case 'error':
            terminal.writeln(`\x1b[31mError: ${msg.message}\x1b[0m`);
            break;
        }
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
      setStatusMessage('Connection error');
    };

    ws.onclose = (event) => {
      wsRef.current = null;
      if (event.code !== 1000 && reconnectAttempts.current < 3) {
        reconnectAttempts.current++;
        setStatusMessage(`Reconnecting (${reconnectAttempts.current}/3)...`);
        setTimeout(connectWebSocket, 2000);
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage('Disconnected');
      }
    };

    const inputHandler = terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => inputHandler.dispose();
  }, [currentSession, imageRef, initialWorkingDir]);

  const handleReconnect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttempts.current = 0;
    await terminateSession();
    
    setConnectionStatus('connecting');
    setStatusMessage('Reconnecting...');
    
    const session = await createSession(imageRef, lastWorkingDir.current);
    if (!session) {
      setConnectionStatus('error');
      setStatusMessage('Failed to reconnect');
    }
  }, [terminateSession, createSession, imageRef]);

  const handleCopyImage = useCallback(() => {
    navigator.clipboard.writeText(imageRef);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [imageRef]);

  const showLoading = sessionLoading;
  const showError = !showLoading && (sessionError || !runtimeInfo?.available);

  if (!imageRef) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#1e1e1e' }}>
        <Alert severity="error">No image reference provided</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#1e1e1e' }}>
      {/* Header bar */}
      <AppBar position="static" sx={{ bgcolor: '#252526' }} elevation={0}>
        <Toolbar variant="dense" sx={{ minHeight: 40 }}>
          <TerminalIcon sx={{ mr: 1, color: '#0dbc79' }} />
          <Typography 
            variant="subtitle1" 
            sx={{ 
              flexGrow: 1, 
              fontFamily: 'monospace',
              color: '#d4d4d4',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={imageRef}
          >
            {getShortImageName(imageRef)}
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Connection status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 2 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: connectionStatus === 'connected' ? '#0dbc79' :
                           connectionStatus === 'connecting' ? '#e5e510' :
                           connectionStatus === 'error' ? '#cd3131' : '#666666'
                }}
              />
              <Typography variant="caption" sx={{ color: '#999' }}>
                {statusMessage}
              </Typography>
            </Box>

            <Tooltip title="Copy image reference">
              <IconButton size="small" onClick={handleCopyImage} sx={{ color: '#d4d4d4' }}>
                {copied ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Reconnect">
              <IconButton size="small" onClick={handleReconnect} sx={{ color: '#d4d4d4' }}>
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Terminal content */}
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Box
          ref={terminalRef}
          onClick={() => terminalInstance.current?.focus()}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            p: 1,
            cursor: 'text',
            visibility: (showLoading || showError) ? 'hidden' : 'visible',
            overflow: 'hidden',
            '& .xterm': { 
              height: '100%',
              width: '100%'
            },
            '& .xterm-screen': {
              width: '100% !important'
            },
            '& .xterm-viewport': { 
              overflowY: 'auto !important',
              overflowX: 'hidden !important'
            },
            '& .xterm-scroll-area': {
              visibility: 'hidden'
            }
          }}
        />

        {showLoading && (
          <Box sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#1e1e1e'
          }}>
            <CircularProgress size={40} />
            <Typography sx={{ mt: 2, color: '#d4d4d4' }}>
              Creating container session...
            </Typography>
          </Box>
        )}

        {showError && (
          <Box sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#1e1e1e',
            p: 3
          }}>
            <Alert severity="warning" sx={{ maxWidth: 500 }}>
              <Typography variant="subtitle1" gutterBottom>
                Container Terminal Unavailable
              </Typography>
              <Typography variant="body2">
                {sessionError || 'No container runtime detected.'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Install Docker Desktop or Podman to enable this feature.
              </Typography>
            </Alert>
          </Box>
        )}
      </Box>
    </Box>
  );
}
