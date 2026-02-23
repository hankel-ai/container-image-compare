/**
 * Container Terminal Component
 * 
 * ============================================================================
 * IMPORTANT: Docker/Podman Runtime Dependency Notice
 * ============================================================================
 * 
 * This component provides an interactive terminal for container sessions.
 * It requires Docker or Podman to be installed on the host system.
 * 
 * NO OTHER component in this application requires Docker or Podman.
 * If no container runtime is detected, this component will display a
 * disabled state, but all other app features remain fully functional.
 * 
 * ============================================================================
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Box, Typography, IconButton, CircularProgress, Alert, Tooltip } from '@mui/material';
import { Close, Refresh, OpenInFull, CloseFullscreen } from '@mui/icons-material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useContainerTerminalStore } from '../store/containerTerminal';

interface ContainerTerminalProps {
  imageRef: string;
  workingDir?: string;  // Only pass when explicitly set (from Filesystem tab)
  onClose?: () => void;
  height?: number | string;
}

export default function ContainerTerminal({
  imageRef,
  workingDir,  // undefined when not explicitly set
  onClose,
  height = 400
}: ContainerTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const attachedElement = useRef<HTMLDivElement | null>(null);  // Track which element we attached to
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState('Initializing terminal...');

  const {
    currentSession,
    sessionLoading,
    sessionError,
    runtimeInfo,
    createSession,
    terminateSession
  } = useContainerTerminalStore();

  const currentSessionRef = useRef(currentSession);
  const [terminalReady, setTerminalReady] = useState(false);

  // Keep currentSessionRef in sync with currentSession
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  // Initialize terminal - wait for container to have valid dimensions
  useEffect(() => {
    // Check if the DOM element changed (React re-render)
    if (terminalRef.current && attachedElement.current && terminalRef.current !== attachedElement.current) {
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
        terminalInstance.current = null;
      }
      attachedElement.current = null;
    }
    
    if (!terminalRef.current || terminalInstance.current) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    
    const initTerminal = () => {
      if (!terminalRef.current) {
        return false;
      }
      
      // Check if container has valid dimensions
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
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
        attachedElement.current = terminalRef.current;  // Track which element we attached to
      } catch (err) {
        console.error('[ContainerTerminal] terminal.open() error:', err);
        return false;
      }
      
      // Schedule fit after a short delay to ensure DOM is ready
      requestAnimationFrame(() => {
        if (fitAddon.current) {
          fitAddon.current.fit();
        }
      });

      terminalInstance.current = terminal;
      setTerminalReady(true);
      return true;
    };

    // Try to initialize immediately
    if (!initTerminal()) {
      // Use ResizeObserver to wait for valid dimensions
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            if (initTerminal()) {
              resizeObserver?.disconnect();
              resizeObserver = null;
            }
          }
        }
      });
      
      resizeObserver.observe(terminalRef.current);
    }

    // Handle window resize
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        // Send resize to backend
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

    // Cleanup function - always runs on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
        terminalInstance.current = null;
      }
      attachedElement.current = null;
      setTerminalReady(false);
    };
  }, []);

  // Create session when component mounts
  useEffect(() => {
    if (!runtimeInfo?.available) {
      setConnectionStatus('error');
      setStatusMessage('Container runtime not available. Install Docker or Podman.');
      return;
    }

    const initSession = async () => {
      setConnectionStatus('connecting');
      setStatusMessage('Creating container session...');
      
      const session = await createSession(imageRef, workingDir);
      if (!session) {
        setConnectionStatus('error');
        setStatusMessage('Failed to create container session');
      }
    };

    initSession();

    // Cleanup on unmount - terminate session
    return () => {
      terminateSession();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [imageRef, workingDir, runtimeInfo?.available]);

  // Connect WebSocket when session is ready and terminal is initialized
  useEffect(() => {
    if (!currentSession || currentSession.status !== 'running' || !terminalReady) {
      return;
    }

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentSession?.sessionId, currentSession?.status, terminalReady]);

  // Connect to WebSocket
  const connectWebSocket = useCallback(() => {
    const session = currentSessionRef.current;
    if (!session || wsRef.current) {
      return;
    }

    const terminal = terminalInstance.current;
    if (!terminal) {
      return;
    }

    setConnectionStatus('connecting');
    setStatusMessage('Connecting to container...');

    // Construct WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?sessionId=${session.sessionId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      setStatusMessage('Connected');
      reconnectAttempts.current = 0;

      terminal.writeln('\x1b[32m*** Connected to container terminal ***\x1b[0m');
      terminal.writeln(`\x1b[90mImage: ${imageRef}\x1b[0m`);
      // Only show working directory if it was explicitly set (from Filesystem tab)
      if (workingDir) {
        terminal.writeln(`\x1b[90mWorking directory: ${workingDir}\x1b[0m`);
      }
      terminal.writeln('');

      // Send initial resize
      ws.send(JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'output':
            terminal.write(msg.data);
            break;
          case 'connected':
            // Already handled
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
          case 'heartbeat':
          case 'pong':
            // Ignore heartbeats
            break;
        }
      } catch {
        // Raw text output
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

      if (event.code !== 1000) {
        setConnectionStatus('disconnected');
        setStatusMessage('Connection lost. Click Reconnect to start a new session.');
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage('Disconnected');
      }
    };

    // Handle terminal input
    const inputHandler = terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      inputHandler.dispose();
    };
  }, [imageRef, workingDir]);

  // Handle reconnect - create a fresh session
  const handleReconnect = useCallback(async () => {
    // Close existing WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttempts.current = 0;
    
    // Terminate existing session and create a new one
    await terminateSession();
    
    setConnectionStatus('connecting');
    setStatusMessage('Reconnecting...');
    
    const session = await createSession(imageRef, workingDir);
    if (!session) {
      setConnectionStatus('error');
      setStatusMessage('Failed to reconnect');
    }
    // WebSocket will auto-connect when session becomes ready (via useEffect)
  }, [terminateSession, createSession, imageRef, workingDir]);

  // Handle close
  const handleClose = useCallback(() => {
    terminateSession();
    onClose?.();
  }, [terminateSession, onClose]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(!isFullscreen);
    setTimeout(() => {
      fitAddon.current?.fit();
    }, 100);
  }, [isFullscreen]);

  // Determine if we should show terminal or an overlay
  const showLoading = sessionLoading;
  const showError = !showLoading && (sessionError || !runtimeInfo?.available);

  return (
    <Box
      sx={{
        height: isFullscreen ? '100vh' : height,
        width: isFullscreen ? '100vw' : '100%',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 9999 : 'auto',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#1e1e1e',
        borderRadius: isFullscreen ? 0 : 1,
        overflow: 'hidden'
      }}
    >
      {/* Terminal header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 0.5,
          bgcolor: '#252526',
          borderBottom: '1px solid #3c3c3c'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: connectionStatus === 'connected' ? '#0dbc79' :
                       connectionStatus === 'connecting' ? '#e5e510' :
                       connectionStatus === 'error' ? '#cd3131' : '#666666'
            }}
          />
          <Typography variant="caption" sx={{ color: '#d4d4d4' }}>
            {statusMessage}
          </Typography>
        </Box>
        <Box>
          <Tooltip title="Reconnect">
            <IconButton size="small" onClick={handleReconnect} sx={{ color: '#d4d4d4' }}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <IconButton size="small" onClick={toggleFullscreen} sx={{ color: '#d4d4d4' }}>
              {isFullscreen ? <CloseFullscreen fontSize="small" /> : <OpenInFull fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close terminal">
            <IconButton size="small" onClick={handleClose} sx={{ color: '#d4d4d4' }}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Terminal content - always rendered to keep xterm attached */}
      <Box
        sx={{
          flex: 1,
          position: 'relative',
          minHeight: 200
        }}
      >
        {/* Terminal container - always present */}
        <Box
          ref={terminalRef}
          data-testid="terminal-container"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            p: 1,
            visibility: (showLoading || showError) ? 'hidden' : 'visible',
            '& .xterm': {
              height: '100%'
            },
            '& .xterm-viewport': {
              overflowY: 'auto'
            }
          }}
        />

        {/* Loading overlay */}
        {showLoading && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#1e1e1e'
            }}
          >
            <CircularProgress size={40} />
            <Typography sx={{ mt: 2, color: '#d4d4d4' }}>
              Creating container session...
            </Typography>
          </Box>
        )}

        {/* Error overlay */}
        {showError && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#1e1e1e',
              p: 3
            }}
          >
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
