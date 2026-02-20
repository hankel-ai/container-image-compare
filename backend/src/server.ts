import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { APP_PATHS } from './services/settings';
import comparisonRoutes from './routes/comparison';
import credentialsRoutes from './routes/credentials';
import settingsRoutes from './routes/settings';
import historyRoutes from './routes/history';
import downloadRoutes from './routes/download';
import cacheRoutes from './routes/cache';
/**
 * Container Terminal Routes
 * 
 * IMPORTANT: The routes below are for the interactive terminal feature ONLY.
 * This feature requires Docker or Podman to be installed.
 * NO OTHER functionality in this app requires Docker or Podman.
 * All core features (image comparison, filesystem browsing) work without it.
 */
import containerTerminalRoutes from './routes/containerTerminal';
import { containerTerminalService } from './services/containerTerminal';
import { setupTerminalWebSocket, closeAllTerminalConnections } from './services/terminalWebSocket';

// Only load .env in development mode (production uses defaults or system env vars)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();
// In dev mode, .env sets PORT=3000 for backend
// In production mode, defaults to 5000 (browser access port)
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/comparison', comparisonRoutes);
app.use('/api/credentials', credentialsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/cache', cacheRoutes);
/**
 * Container Terminal API Routes
 * 
 * IMPORTANT: These routes require Docker or Podman to be installed.
 * They are used EXCLUSIVELY for the interactive terminal feature.
 * All other app features work without any container runtime.
 */
app.use('/api/container-terminal', containerTerminalRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  // __dirname is dist/backend/src, so we need to go up 4 levels to reach the app root
  // then into frontend/dist
  const frontendPath = path.join(__dirname, '../../../../frontend/dist');
  console.log(`📁 Serving frontend from: ${frontendPath}`);
  app.use(express.static(frontendPath));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

/**
 * Setup WebSocket for Container Terminal
 * 
 * IMPORTANT: This WebSocket server is used EXCLUSIVELY for the interactive
 * terminal feature. It requires Docker or Podman to be installed.
 * All other app features work without any WebSocket connection.
 */
setupTerminalWebSocket(server);

// Start server
server.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 App data directory: ${APP_PATHS.appData}`);
  console.log(`   └─ Cache: ${APP_PATHS.cache}`);
  console.log(`   └─ History: ${APP_PATHS.history}`);
  console.log(`   └─ Logs: ${APP_PATHS.logs}`);
  
  /**
   * Container Runtime Detection
   * 
   * IMPORTANT: Docker/Podman is required ONLY for the interactive terminal feature.
   * All other app features (image download, comparison, filesystem browsing) 
   * work completely independently using the OCI registry HTTP API.
   */
  console.log('');
  console.log('🔍 Detecting container runtime for terminal feature...');
  const runtime = await containerTerminalService.initialize();
  
  if (runtime.available) {
    console.log(`✅ ${runtime.type === 'docker' ? 'Docker' : 'Podman'} ${runtime.version} detected`);
    console.log('   Interactive terminal feature: ENABLED');
  } else {
    console.log('⚠️  No container runtime detected (Docker or Podman)');
    console.log('   Interactive terminal feature: DISABLED');
    console.log('   To enable: Install Docker Desktop or Podman');
    console.log('   Note: All other features work normally without Docker/Podman');
  }
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  closeAllTerminalConnections();
  await containerTerminalService.cleanupAllSessions();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  closeAllTerminalConnections();
  await containerTerminalService.cleanupAllSessions();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
