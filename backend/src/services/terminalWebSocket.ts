/**
 * Container Terminal WebSocket Handler
 * 
 * ============================================================================
 * IMPORTANT: Docker/Podman Runtime Dependency Notice
 * ============================================================================
 * 
 * This WebSocket handler provides real-time terminal I/O for container sessions.
 * It requires Docker or Podman to be installed on the host system.
 * 
 * Uses node-pty to create a real pseudo-terminal, enabling proper TTY support
 * for interactive shells with prompts and job control.
 * 
 * NO OTHER WebSocket functionality in this application requires Docker or Podman.
 * This is used EXCLUSIVELY for the interactive terminal feature.
 * 
 * ============================================================================
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
import { Server } from 'http';
import { execSync } from 'child_process';
import { containerTerminalService } from '../services/containerTerminal';
import { createLogger } from '../utils/logger';
import * as pty from 'node-pty';

const logger = createLogger('ContainerTerminalWebSocket');

// Track active WebSocket connections and their PTY processes
const activeConnections = new Map<string, WebSocket>();
const activePtys = new Map<string, pty.IPty>();
const connectionAlive = new Map<string, boolean>();

/**
 * Setup WebSocket server for container terminal connections
 * 
 * WebSocket URL: ws://host:port/ws/terminal/:sessionId
 */
export function setupTerminalWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ 
    server,
    path: '/ws/terminal'
  });

  logger.info('Container terminal WebSocket server initialized (using node-pty for real TTY support)');
  logger.info('Note: WebSocket is used ONLY for the interactive terminal feature');

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract session ID from URL
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      logger.warn('WebSocket connection rejected: missing sessionId');
      ws.close(4000, 'Missing sessionId parameter');
      return;
    }

    logger.info(`WebSocket connection established for session ${sessionId}`);
    handleTerminalConnection(ws, sessionId);
  });

  wss.on('error', (error: Error) => {
    logger.error('WebSocket server error', { error: error.message });
  });

  return wss;
}

/**
 * Wait for a container to be in the 'running' state.
 * Polls up to maxRetries times with a delay between each attempt.
 */
async function waitForContainerReady(containerName: string, cmd: string, maxRetries: number = 5, delayMs: number = 500): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = execSync(`${cmd} inspect -f "{{.State.Status}}" ${containerName}`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (status === 'running') {
        logger.info(`Container ${containerName} is ready (attempt ${i + 1})`);
        return true;
      }
      logger.debug(`Container ${containerName} status: ${status}, waiting...`);
    } catch (err: any) {
      logger.debug(`Container readiness check failed: ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Handle a terminal WebSocket connection using node-pty for real TTY support
 */
async function handleTerminalConnection(ws: WebSocket, sessionId: string): Promise<void> {
  const session = containerTerminalService.getSession(sessionId);
  
  if (!session) {
    logger.warn(`Session ${sessionId} not found`);
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
    ws.close(4004, 'Session not found');
    return;
  }

  if (session.status !== 'running') {
    logger.warn(`Session ${sessionId} is not running (status: ${session.status})`);
    ws.send(JSON.stringify({ type: 'error', message: `Session is ${session.status}` }));
    ws.close(4001, `Session is ${session.status}`);
    return;
  }

  // Store the connection and mark alive for ping/pong
  activeConnections.set(sessionId, ws);
  connectionAlive.set(sessionId, true);

  ws.on('pong', () => {
    connectionAlive.set(sessionId, true);
  });

  // Get the container runtime and container name
  const runtime = containerTerminalService.getRuntime();
  const cmd = runtime.type === 'docker' ? 'docker' : 'podman';
  
  // Use the container name format which is consistent and reliable
  const containerName = `cic-terminal-${sessionId.slice(0, 8)}`;

  logger.info(`Attaching to container ${containerName} with node-pty for real TTY`);

  // Wait for container to be ready before exec
  const isReady = await waitForContainerReady(containerName, cmd);
  if (!isReady) {
    logger.error(`Container ${containerName} not ready after polling`);
    ws.send(JSON.stringify({ type: 'error', message: 'Container failed to start in time' }));
    ws.close(4003, 'Container not ready');
    activeConnections.delete(sessionId);
    connectionAlive.delete(sessionId);
    return;
  }

  // Use node-pty to create a real pseudo-terminal
  // This gives us proper TTY support so -it flags work correctly
  // Only use -w flag when workingDir is explicitly set (from Filesystem tab)
  const execArgs = [
    'exec',
    '-it',
    ...(session.workingDir ? ['-w', session.workingDir] : []),
    containerName,
    '/bin/sh'
  ];

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(cmd, execArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string }
    });
  } catch (err: any) {
    logger.error(`Failed to spawn PTY for session ${sessionId}: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: `Failed to start terminal: ${err.message}` }));
    ws.close(4002, 'PTY spawn failed');
    activeConnections.delete(sessionId);
    connectionAlive.delete(sessionId);
    return;
  }

  activePtys.set(sessionId, ptyProcess);
  logger.info(`Started PTY exec process for session ${sessionId} (PID: ${ptyProcess.pid})`);

  // Send initial connection success
  ws.send(JSON.stringify({ 
    type: 'connected', 
    sessionId,
    message: `Connected to container terminal (${runtime.type} with PTY)` 
  }));

  // Handle data from PTY -> WebSocket
  ptyProcess.onData((data: string) => {
    logger.debug(`PTY output (${data.length} bytes): ${data.substring(0, 100).replace(/\n/g, '\\n')}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'output', 
        data: data 
      }));
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    logger.info(`PTY process for session ${sessionId} exited`, { exitCode, signal });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'exit', 
        code: exitCode 
      }));
      ws.close(1000, 'Container process exited');
    }
    activeConnections.delete(sessionId);
    activePtys.delete(sessionId);
  });

  // Handle data from WebSocket -> PTY
  ws.on('message', (message: Buffer | string) => {
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'input':
          // Send input to PTY
          ptyProcess.write(msg.data);
          break;

        case 'resize':
          // Resize terminal
          if (msg.cols && msg.rows) {
            ptyProcess.resize(msg.cols, msg.rows);
            logger.debug(`Resized PTY for session ${sessionId} to ${msg.cols}x${msg.rows}`);
          }
          break;

        case 'ping':
          // Respond to ping
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        default:
          logger.debug(`Unknown message type: ${msg.type}`);
      }
    } catch (error: any) {
      // If not JSON, treat as raw input
      ptyProcess.write(message.toString());
    }
  });

  // Handle WebSocket close
  ws.on('close', (code: number, reason: Buffer) => {
    logger.info(`WebSocket closed for session ${sessionId}`, { code, reason: reason.toString() });
    
    // Kill the PTY process
    try {
      ptyProcess.kill();
    } catch (err) {
      // Ignore kill errors
    }

    activeConnections.delete(sessionId);
    activePtys.delete(sessionId);

    // Terminate the container session when WebSocket closes
    // This ensures containers are cleaned up when user navigates away
    containerTerminalService.terminateSession(sessionId).catch(err => {
      logger.error(`Failed to terminate session on WebSocket close`, { sessionId, error: err.message });
    });
  });

  // Handle WebSocket errors
  ws.on('error', (error: Error) => {
    logger.error(`WebSocket error for session ${sessionId}`, { error: error.message });
  });

  // Setup heartbeat with WebSocket-level ping/pong to detect half-open connections
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(heartbeatInterval);
      return;
    }

    // Check if previous ping was answered
    if (connectionAlive.get(sessionId) === false) {
      logger.warn(`Connection dead for session ${sessionId}, terminating`);
      clearInterval(heartbeatInterval);
      ws.terminate();
      return;
    }

    // Mark as not alive, then ping — pong handler will mark alive again
    connectionAlive.set(sessionId, false);
    ws.ping();
    // Also send JSON heartbeat for application-level keep-alive
    ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
  }, 30000);

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    connectionAlive.delete(sessionId);
  });
}

/**
 * Cleanup function - close all active connections and PTY processes
 */
export function closeAllTerminalConnections(): void {
  logger.info('Closing all terminal WebSocket connections');
  
  // Kill all PTY processes
  for (const [sessionId, ptyProcess] of activePtys.entries()) {
    try {
      ptyProcess.kill();
    } catch {
      // Ignore kill errors
    }
  }
  activePtys.clear();
  
  // Close all WebSocket connections
  for (const [sessionId, ws] of activeConnections.entries()) {
    try {
      ws.close(1001, 'Server shutting down');
    } catch {
      // Ignore close errors
    }
  }
  
  activeConnections.clear();
  connectionAlive.clear();
}
