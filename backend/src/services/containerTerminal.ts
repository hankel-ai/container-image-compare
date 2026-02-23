/**
 * Container Terminal Service
 * 
 * ============================================================================
 * IMPORTANT: Docker/Podman Runtime Dependency Notice
 * ============================================================================
 * 
 * This service requires Docker or Podman to be installed on the host system.
 * The Docker/Podman dependency is used EXCLUSIVELY for the interactive terminal
 * feature that allows users to run a shell inside a downloaded container image.
 * 
 * NO OTHER functionality in this application requires Docker or Podman.
 * The core features (image downloading, comparison, filesystem browsing) work
 * completely independently using the OCI registry HTTP API.
 * 
 * If neither Docker nor Podman is detected, this feature will be gracefully
 * disabled (grayed out in UI), but all other app features remain fully functional.
 * 
 * ============================================================================
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { spawn, spawnSync, ChildProcess, execSync } from 'child_process';
import crypto from 'crypto';

const logger = createLogger('ContainerTerminal');

/**
 * Represents the detected container runtime (Docker or Podman)
 * Used ONLY for the interactive terminal feature
 */
export interface ContainerRuntime {
  type: 'docker' | 'podman' | 'none';
  socketPath: string | null;
  version: string | null;
  available: boolean;
}

/**
 * Represents an active container terminal session
 * Sessions are short-lived and automatically cleaned up when the user navigates away
 */
export interface ContainerSession {
  id: string;
  imageRef: string;
  containerId: string | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  createdAt: Date;
  workingDir?: string;  // Only set when explicitly specified (from Filesystem tab)
  runtime: 'docker' | 'podman';
  error?: string;
}

/**
 * Container Terminal Service
 * 
 * Manages the lifecycle of interactive container terminal sessions.
 * This is the ONLY service in the application that requires Docker/Podman.
 */
class ContainerTerminalService extends EventEmitter {
  private runtime: ContainerRuntime = {
    type: 'none',
    socketPath: null,
    version: null,
    available: false
  };
  
  private sessions: Map<string, ContainerSession> = new Map();
  private containerProcesses: Map<string, ChildProcess> = new Map();
  private initialized: boolean = false;
  
  // Track images that have been prepared (loaded into podman) by imageRef -> localTag
  private preparedImages: Map<string, { localTag: string; cacheDir: string }> = new Map();
  // Track images currently being prepared to avoid duplicate work
  private preparingImages: Set<string> = new Set();

  constructor() {
    super();
  }

  /**
   * Initialize the service and detect available container runtime.
   * Called once on server startup.
   * 
   * Note: This detection is ONLY for the terminal feature. If no runtime
   * is found, all other application features continue to work normally.
   */
  async initialize(): Promise<ContainerRuntime> {
    if (this.initialized) {
      return this.runtime;
    }

    logger.info('Detecting container runtime for terminal feature...');
    logger.info('Note: Docker/Podman is ONLY required for the interactive terminal feature.');
    logger.info('All other application features work without any container runtime.');

    // Try to detect Docker first, then Podman
    const dockerRuntime = await this.detectDocker();
    if (dockerRuntime.available) {
      this.runtime = dockerRuntime;
      logger.info(`✅ Docker detected (version ${dockerRuntime.version}) - Terminal feature enabled`);
      this.initialized = true;
      return this.runtime;
    }

    const podmanRuntime = await this.detectPodman();
    if (podmanRuntime.available) {
      this.runtime = podmanRuntime;
      logger.info(`✅ Podman detected (version ${podmanRuntime.version}) - Terminal feature enabled`);
      this.initialized = true;
      return this.runtime;
    }

    // No runtime found - terminal feature disabled but app works fine
    this.runtime = { type: 'none', socketPath: null, version: null, available: false };
    logger.warn('⚠️  No container runtime detected (Docker or Podman)');
    logger.warn('   The interactive terminal feature will be disabled.');
    logger.warn('   All other features (image comparison, filesystem browsing) work normally.');
    logger.warn('   To enable terminal: Install Docker Desktop or Podman');
    
    this.initialized = true;
    return this.runtime;
  }

  /**
   * Detect Docker daemon availability
   */
  private async detectDocker(): Promise<ContainerRuntime> {
    try {
      const result = execSync('docker version --format "{{.Server.Version}}"', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      // Determine socket path
      let socketPath: string | null = null;
      if (process.platform === 'win32') {
        socketPath = '//./pipe/docker_engine';
      } else {
        socketPath = '/var/run/docker.sock';
        // Check for rootless docker
        const userSocket = `${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 1000}`}/docker.sock`;
        if (fs.existsSync(userSocket)) {
          socketPath = userSocket;
        }
      }

      return {
        type: 'docker',
        socketPath,
        version: result,
        available: true
      };
    } catch (err: any) {
      logger.debug(`Docker detection failed: ${err.message}`);
      return { type: 'none', socketPath: null, version: null, available: false };
    }
  }

  /**
   * Detect Podman availability (daemonless container runtime)
   */
  private async detectPodman(): Promise<ContainerRuntime> {
    try {
      // Try simple version command first (more compatible across versions)
      let result: string;
      try {
        result = execSync('podman --version', {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        // Extract version number from "podman version X.Y.Z"
        const versionMatch = result.match(/(\d+\.\d+\.\d+)/);
        result = versionMatch ? versionMatch[1] : result;
      } catch (versionErr: any) {
        logger.debug(`Podman --version failed: ${versionErr.message}`);
        // Try alternative format
        result = execSync('podman version --format "{{.Version}}"', {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
      }

      // Podman socket paths vary by platform
      let socketPath: string | null = null;
      if (process.platform === 'win32') {
        socketPath = '//./pipe/podman-machine-default';
      } else if (process.platform === 'darwin') {
        // macOS - podman machine socket
        const homeDir = process.env.HOME || '';
        socketPath = `${homeDir}/.local/share/containers/podman/machine/podman.sock`;
      } else {
        // Linux - user socket (may not exist for rootless in container)
        const uid = process.getuid?.() || 1000;
        socketPath = `${process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`}/podman/podman.sock`;
      }

      return {
        type: 'podman',
        socketPath,
        version: result,
        available: true
      };
    } catch (err: any) {
      logger.debug(`Podman detection failed: ${err.message}`);
      if (err.stderr) {
        logger.debug(`Podman stderr: ${err.stderr.toString()}`);
      }
      return { type: 'none', socketPath: null, version: null, available: false };
    }
  }

  /**
   * Get the detected runtime information
   */
  getRuntime(): ContainerRuntime {
    return this.runtime;
  }

  /**
   * Check if the terminal feature is available
   */
  isAvailable(): boolean {
    return this.runtime.available;
  }

  /**
   * Create a new container terminal session from a cached image
   * 
   * @param imageRef - The image reference (e.g., "nginx:latest")
   * @param tarPath - Path to the cached filesystem tar (docker-image.tar)
   * @param workingDir - Initial working directory inside the container (only set when explicitly specified from Filesystem tab)
   * @param usePodmanPull - If true, check for existing image or pull directly using podman/docker
   * @param cacheFolderName - The cache folder name (used to construct local image tag)
   */
  async createSession(
    imageRef: string,
    tarPath: string,
    workingDir?: string,
    usePodmanPull: boolean = false,
    cacheFolderName?: string
  ): Promise<ContainerSession> {
    if (!this.runtime.available) {
      throw new Error('Container runtime not available. Install Docker or Podman to use this feature.');
    }

    const sessionId = crypto.randomUUID();
    const session: ContainerSession = {
      id: sessionId,
      imageRef,
      containerId: null,
      status: 'starting',
      createdAt: new Date(),
      ...(workingDir && { workingDir }),  // Only include if explicitly specified
      runtime: this.runtime.type as 'docker' | 'podman'
    };

    this.sessions.set(sessionId, session);
    logger.info(`Creating container session ${sessionId} for image ${imageRef}`);

    try {
      // Resolve which image tag to use for starting the container
      let imageTag = imageRef;

      // Check if image was pre-prepared by background process
      const prepared = this.preparedImages.get(imageRef);
      if (prepared) {
        logger.info(`Using pre-prepared image ${prepared.localTag} for ${imageRef}`);
        imageTag = prepared.localTag;
      } else if (usePodmanPull) {
        // Layer data not available in cache - check if image already exists in podman/docker
        // First check by the local tag (cic-terminal/<cacheFolderId>:latest)
        const localTag = cacheFolderName ? `cic-terminal/${cacheFolderName}:latest` : null;

        let imageFound = false;
        if (localTag) {
          imageFound = await this.checkImageExists(localTag);
          if (imageFound) {
            logger.info(`Image found as ${localTag} in ${this.runtime.type}, using it directly`);
            imageTag = localTag;
          }
        }

        // Also check by original image ref
        if (!imageFound) {
          imageFound = await this.checkImageExists(imageRef);
          if (imageFound) {
            logger.info(`Image found as ${imageRef} in ${this.runtime.type}, using it directly`);
            imageTag = imageRef;
          }
        }

        if (!imageFound) {
          // Fall back to direct podman/docker pull
          logger.info(`Image not found in ${this.runtime.type}, pulling: ${imageRef}`);
          imageTag = await this.pullImageDirectly(imageRef);
        }
      } else {
        // Load the image into Docker/Podman the traditional way
        imageTag = await this.loadImage(tarPath, imageRef);
      }

      // Create and start the container
      const containerId = await this.startContainer(imageTag, workingDir, sessionId);
      
      session.containerId = containerId;
      session.status = 'running';
      this.sessions.set(sessionId, session);

      logger.info(`Container session ${sessionId} started with container ${containerId}`);
      return session;
    } catch (error: any) {
      session.status = 'error';
      session.error = error.message;
      this.sessions.set(sessionId, session);
      logger.error(`Failed to create session ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if an image already exists in podman/docker
   */
  private async checkImageExists(imageRef: string): Promise<boolean> {
    const cmd = this.runtime.type === 'docker' ? 'docker' : 'podman';
    
    try {
      const result = spawnSync(cmd, ['image', 'inspect', imageRef], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Exit code 0 means image exists
      if (result.status === 0) {
        logger.info(`Image ${imageRef} found in ${cmd}`);
        return true;
      }
      
      logger.debug(`Image ${imageRef} not found in ${cmd}`);
      return false;
    } catch (err) {
      logger.debug(`Error checking if image exists: ${err}`);
      return false;
    }
  }

  /**
   * Pull an image directly using podman/docker
   * Used as a fallback when the layer data isn't available in cache
   */
  private async pullImageDirectly(imageRef: string): Promise<string> {
    const cmd = this.runtime.type === 'docker' ? 'docker' : 'podman';
    
    logger.info(`Pulling image with ${cmd} pull ${imageRef}`);
    
    return new Promise((resolve, reject) => {
      const pullProcess = spawn(cmd, ['pull', imageRef], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stderr = '';
      pullProcess.stderr?.on('data', (data) => { stderr += data.toString(); });
      
      // 15 minute timeout for large images
      const timeout = setTimeout(() => {
        pullProcess.kill('SIGTERM');
        reject(new Error('Image pull timed out after 15 minutes'));
      }, 900000);
      
      pullProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          logger.info(`Successfully pulled image ${imageRef}`);
          resolve(imageRef);
        } else {
          reject(new Error(`Failed to pull image: ${stderr}`));
        }
      });
      
      pullProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Load a Docker-compatible image tar into the container runtime
   * 
   * ============================================================================
   * FULL DOCKER COMPATIBILITY (Option A Implementation)
   * ============================================================================
   * This uses `docker load` / `podman load` with a proper OCI image archive
   * that preserves all image metadata including CMD, ENTRYPOINT, ENV, etc.
   * 
   * The result is exactly equivalent to `docker run -it <image>`.
   * ============================================================================
   */
  private async loadImage(dockerImageTarPath: string, imageRef: string): Promise<string> {
    const cmd = this.runtime.type === 'docker' ? 'docker' : 'podman';

    // Parse image ref to create a clean local tag
    const imageName = imageRef.replace(/[^a-zA-Z0-9._\/-]/g, '_').toLowerCase();
    const localTag = `cic-terminal/${imageName}:latest`;

    return new Promise<string>(async (resolve, reject) => {
      logger.debug(`Loading Docker image from ${dockerImageTarPath}`);
      
      // Always remove the old image and reload fresh to ensure proper format
      // This is important because previously imported images may be corrupted
      try {
        logger.debug(`Removing any existing image ${localTag} to ensure fresh load`);
        execSync(`${cmd} rmi -f ${localTag}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        logger.debug(`Removed existing image ${localTag}`);
      } catch {
        // Image doesn't exist, that's fine
      }

      try {
        // Use docker load / podman load for full image compatibility
        // This preserves CMD, ENTRYPOINT, ENV, WORKDIR, etc.
        logger.info(`Running: ${cmd} load -i ${dockerImageTarPath}`);
        
        // Use spawn instead of execSync for better handling of large images
        // 15 minute timeout for very large images (2GB+)
        const loadOutput = await new Promise<string>((resolveLoad, rejectLoad) => {
          const loadProcess = spawn(cmd, ['load', '-i', dockerImageTarPath], {
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          let stdout = '';
          let stderr = '';
          
          loadProcess.stdout?.on('data', (data) => {
            stdout += data.toString();
            // Log progress for large images
            logger.debug(`Load progress: ${data.toString().trim()}`);
          });
          
          loadProcess.stderr?.on('data', (data) => {
            stderr += data.toString();
          });
          
          // 15 minute timeout for very large images
          const timeout = setTimeout(() => {
            loadProcess.kill('SIGTERM');
            rejectLoad(new Error(`Image load timed out after 15 minutes. Image may be too large.`));
          }, 900000);
          
          loadProcess.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              resolveLoad(stdout);
            } else {
              rejectLoad(new Error(`Load failed with code ${code}: ${stderr || stdout}`));
            }
          });
          
          loadProcess.on('error', (err) => {
            clearTimeout(timeout);
            rejectLoad(err);
          });
        });
        
        logger.debug(`Load output: ${loadOutput}`);
        
        // Parse the loaded image tag from output
        // Docker: "Loaded image: repo:tag" or "Loaded image ID: sha256:..."
        // Podman: "Loaded image(s): repo:tag" or "Loaded image: sha256:..."
        const loadedMatch = loadOutput.match(/Loaded image[^:]*:\s*(\S+)/i);
        let loadedTag = loadedMatch ? loadedMatch[1].trim() : null;
        
        if (loadedTag) {
          // If we got a sha256 ID, we need to tag it
          if (loadedTag.startsWith('sha256:')) {
            logger.debug(`Tagging ${loadedTag} as ${localTag}`);
            execSync(`${cmd} tag ${loadedTag} ${localTag}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe']
            });
            loadedTag = localTag;
          } else {
            // Re-tag with our local naming convention for consistency
            try {
              execSync(`${cmd} tag ${loadedTag} ${localTag}`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
              });
              loadedTag = localTag;
            } catch {
              // Keep original tag if re-tagging fails
            }
          }
        } else {
          // Fallback: list recent images and find the one we just loaded
          loadedTag = localTag;
        }

        logger.info(`Image loaded successfully as ${loadedTag}`);

        // Verify image is valid by inspecting it
        try {
          const inspectOutput = execSync(`${cmd} image inspect ${loadedTag} --format "{{.Config.Cmd}} {{.Config.Entrypoint}} {{.RootFS.Layers}}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();
          logger.debug(`Image inspect: ${inspectOutput}`);
          
          // Also list files in the image root
          try {
            const lsOutput = execSync(`${cmd} run --rm ${loadedTag} ls -la / 2>&1 || true`, {
              encoding: 'utf-8',
              timeout: 30000,
              stdio: ['pipe', 'pipe', 'pipe']
            });
            logger.debug(`Image root listing: ${lsOutput}`);
          } catch (lsErr: any) {
            logger.warn(`Could not list image root: ${lsErr.message}`);
          }
        } catch (inspectErr: any) {
          logger.warn(`Image inspect failed: ${inspectErr.message}`);
        }
        
        resolve(loadedTag || localTag);
      } catch (loadErr: any) {
        logger.error(`Failed to load image: ${loadErr.message}`);
        reject(new Error(`Failed to load image into ${cmd}: ${loadErr.message}`));
      }
    });
  }

  /**
   * Start a container in detached mode for WebSocket attachment
   * 
   * ============================================================================
   * DETACHED CONTAINER - WebSocket will use 'podman exec' to attach
   * ============================================================================
   * The container runs a long-lived process (sleep infinity) in detached mode.
   * When the WebSocket connects, it uses node-pty with 'podman exec -it' to
   * get a real pseudo-terminal with proper job control and prompts.
   * ============================================================================
   */
  private async startContainer(
    imageTag: string,
    workingDir: string | undefined,
    sessionId: string
  ): Promise<string> {
    const cmd = this.runtime.type === 'docker' ? 'docker' : 'podman';
    
    // Generate a unique container name
    const containerName = `cic-terminal-${sessionId.slice(0, 8)}`;

    // Start container in DETACHED mode with a long-running process
    // The WebSocket handler will use 'podman exec -it' with node-pty
    // to get a real TTY for the interactive shell
    const args = [
      'run',
      '-d',                    // Detached mode - container runs in background
      '--rm',                  // Auto-remove when stopped
      '--name', containerName,
      // Suppress cgroup warnings when running Podman in Docker
      // --cgroups=disabled prevents conmon cgroup errors in nested containers
      ...(this.runtime.type === 'podman' ? ['--cgroups=disabled'] : []),
      imageTag,
      'sh', '-c',
      // Keep container alive - the shell will be started via 'exec' with real PTY
      'while true; do sleep 1; done'
    ];

    logger.debug(`Starting detached container: ${cmd} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      try {
        logger.info(`Executing: ${cmd} ${JSON.stringify(args)}`);
        const startTime = Date.now();
        
        // Use spawnSync to properly handle argument quoting
        const result = spawnSync(cmd, args, {
          encoding: 'utf-8',
          timeout: 60000,  // 60 seconds - first run may be slow
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          throw new Error(`Command failed: ${result.stderr || result.stdout}`);
        }

        const containerId = result.stdout.trim();
        logger.info(`Container started in ${Date.now() - startTime}ms`);

        if (!containerId) {
          reject(new Error('Container started but no ID returned'));
          return;
        }

        logger.info(`Container ${containerName} started with ID: ${containerId}`);
        
        // Verify container is running
        const status = execSync(`${cmd} inspect -f '{{.State.Status}}' ${containerId}`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (status !== 'running') {
          // Get container logs for debugging
          try {
            const logs = execSync(`${cmd} logs ${containerName}`, {
              encoding: 'utf-8',
              timeout: 5000,
              stdio: ['pipe', 'pipe', 'pipe']
            });
            logger.error(`Container not running. Status: ${status}, Logs: ${logs}`);
          } catch {}
          reject(new Error(`Container not running (status: ${status})`));
          return;
        }

        resolve(containerId);
      } catch (error: any) {
        logger.error(`Failed to start container: ${error.message}`);
        if (error.stderr) {
          logger.error(`stderr: ${error.stderr.toString()}`);
        }
        reject(error);
      }
    });
  }

  /**
   * Get the process for a session (for attaching WebSocket)
   */
  getSessionProcess(sessionId: string): ChildProcess | undefined {
    return this.containerProcesses.get(sessionId);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): ContainerSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): ContainerSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Terminate a container session
   * Called when user navigates away or closes the terminal
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.debug(`Session ${sessionId} not found`);
      return;
    }

    logger.info(`Terminating session ${sessionId}`);
    session.status = 'stopping';
    this.sessions.set(sessionId, session);

    // Kill the container process
    const process = this.containerProcesses.get(sessionId);
    if (process) {
      process.kill('SIGTERM');
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
    }

    // Force stop the container if still running
    if (session.containerId) {
      const cmd = session.runtime === 'docker' ? 'docker' : 'podman';
      try {
        execSync(`${cmd} stop -t 5 ${session.containerId}`, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch {
        // Container may already be stopped
        try {
          execSync(`${cmd} rm -f ${session.containerId}`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch {
          // Ignore errors
        }
      }
    }

    session.status = 'stopped';
    this.sessions.set(sessionId, session);
    this.containerProcesses.delete(sessionId);

    // Remove session after a delay
    setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 5000);

    this.emit('sessionEnded', sessionId);
    logger.info(`Session ${sessionId} terminated`);
  }

  /**
   * Cleanup all sessions - called on server shutdown
   */
  async cleanupAllSessions(): Promise<void> {
    logger.info('Cleaning up all container sessions...');
    
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.terminateSession(id)));

    // Extra cleanup: kill any orphaned containers from previous runs
    const cmd = this.runtime.type === 'docker' ? 'docker' : 'podman';
    if (this.runtime.available) {
      try {
        execSync(`${cmd} ps -qf name=cic-terminal- | xargs -r ${cmd} rm -f`, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch {
        // Ignore cleanup errors
      }

      // Remove temporary images
      try {
        execSync(`${cmd} images -q "cic-terminal:*" | xargs -r ${cmd} rmi -f`, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    logger.info('All container sessions cleaned up');
  }

  /**
   * Execute a resize operation on the container's PTY
   */
  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.containerId) {
      return;
    }

    const cmd = session.runtime === 'docker' ? 'docker' : 'podman';
    try {
      // Resize uses the container exec API
      execSync(`${cmd} exec ${session.containerId} stty cols ${cols} rows ${rows}`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch {
      // Resize may not be supported in all scenarios
    }
  }

  /**
   * Prepare an image for terminal use in the background
   * This creates the docker-image.tar, loads it into podman, and cleans up
   * 
   * @param imageRef - The image reference
   * @param cacheDir - The cache directory containing layers
   * @param imageCacheService - The image cache service instance (passed to avoid circular deps)
   */
  async prepareImageForTerminal(
    imageRef: string, 
    cacheDir: string,
    getDockerImageTarPath: () => Promise<string>
  ): Promise<void> {
    // Skip if runtime not available
    if (!this.runtime.available) {
      logger.debug('Skipping image preparation - no container runtime', { imageRef });
      return;
    }

    // Skip if already prepared or being prepared
    if (this.preparedImages.has(imageRef)) {
      logger.debug('Image already prepared', { imageRef });
      return;
    }
    if (this.preparingImages.has(imageRef)) {
      logger.debug('Image already being prepared', { imageRef });
      return;
    }

    this.preparingImages.add(imageRef);
    logger.info('Starting background image preparation', { imageRef });

    try {
      // Step 1: Create docker-image.tar
      const dockerImageTarPath = await getDockerImageTarPath();
      logger.info('Docker image tar created', { imageRef, path: dockerImageTarPath });

      // Step 2: Generate a unique local tag based on cache folder name
      // The cache folder is named by a hash, use that for uniqueness
      const cacheFolderName = path.basename(cacheDir);
      const localTag = `cic-terminal/${cacheFolderName}:latest`;

      // Step 3: Load image into podman/docker
      const cmd = this.runtime.type;
      logger.info(`Loading image with: ${cmd} load -i ${dockerImageTarPath}`);
      
      const loadOutput = await new Promise<string>((resolve, reject) => {
        const loadProcess = spawn(cmd, ['load', '-i', dockerImageTarPath], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        loadProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
        loadProcess.stderr?.on('data', (data) => { stderr += data.toString(); });
        
        const timeout = setTimeout(() => {
          loadProcess.kill('SIGTERM');
          reject(new Error('Image load timed out after 15 minutes'));
        }, 900000);
        
        loadProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve(stdout);
          else reject(new Error(`Load failed: ${stderr || stdout}`));
        });
        
        loadProcess.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Parse loaded image tag from output
      const loadedMatch = loadOutput.match(/Loaded image[^:]*:\s*(\S+)/i);
      let loadedTag = loadedMatch ? loadedMatch[1].trim() : null;

      // Tag with our unique local name
      if (loadedTag) {
        try {
          execSync(`${cmd} tag ${loadedTag} ${localTag}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          // Remove the original tag if different
          if (loadedTag !== localTag && !loadedTag.startsWith('sha256:')) {
            try {
              execSync(`${cmd} rmi ${loadedTag}`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
              });
            } catch { /* ignore */ }
          }
        } catch { /* ignore tagging errors */ }
      }

      logger.info('Image loaded successfully', { imageRef, localTag });

      // Step 4: Cleanup tar and layers to save space
      const layersDir = path.join(cacheDir, 'layers');
      
      // Delete docker-image.tar
      try {
        await fs.promises.unlink(dockerImageTarPath);
        logger.debug('Deleted docker-image.tar', { imageRef });
      } catch (err) {
        logger.debug('Failed to delete docker-image.tar', { error: (err as Error).message });
      }

      // Delete layers directory
      try {
        const layerFiles = await fs.promises.readdir(layersDir);
        for (const file of layerFiles) {
          await fs.promises.unlink(path.join(layersDir, file));
        }
        await fs.promises.rmdir(layersDir);
        logger.debug('Deleted layers directory', { imageRef });
      } catch (err) {
        logger.debug('Failed to delete layers directory', { error: (err as Error).message });
      }

      // Register the prepared image
      this.preparedImages.set(imageRef, { localTag, cacheDir });
      this.emit('imagePrepared', { imageRef, localTag });
      logger.info('Image preparation complete', { imageRef, localTag });

    } catch (error: any) {
      logger.error('Background image preparation failed', { imageRef, error: error.message });
      // Don't throw - this is background work
    } finally {
      this.preparingImages.delete(imageRef);
    }
  }

  /**
   * Check if an image is prepared for terminal use
   */
  isImagePrepared(imageRef: string): boolean {
    return this.preparedImages.has(imageRef);
  }

  /**
   * Check if an image is currently being prepared (import in progress)
   */
  isImageBeingPrepared(imageRef: string): boolean {
    return this.preparingImages.has(imageRef);
  }

  /**
   * Wait for an image to finish preparing (with timeout)
   * Returns true if image is ready, false if timed out
   */
  async waitForImagePreparation(imageRef: string, timeoutMs: number = 120000): Promise<boolean> {
    // Already prepared
    if (this.preparedImages.has(imageRef)) {
      return true;
    }
    
    // Not being prepared - nothing to wait for
    if (!this.preparingImages.has(imageRef)) {
      return false;
    }
    
    logger.info(`Waiting for image preparation to complete`, { imageRef, timeoutMs });
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkReady = () => {
        // Image is now prepared
        if (this.preparedImages.has(imageRef)) {
          logger.info(`Image preparation completed`, { imageRef, waitedMs: Date.now() - startTime });
          resolve(true);
          return;
        }
        
        // No longer being prepared (finished or failed)
        if (!this.preparingImages.has(imageRef)) {
          // Check one more time if it got prepared
          if (this.preparedImages.has(imageRef)) {
            resolve(true);
          } else {
            logger.info(`Image preparation finished but image not ready`, { imageRef });
            resolve(false);
          }
          return;
        }
        
        // Timeout check
        if (Date.now() - startTime > timeoutMs) {
          logger.warn(`Timeout waiting for image preparation`, { imageRef, timeoutMs });
          resolve(false);
          return;
        }
        
        // Check again in 500ms
        setTimeout(checkReady, 500);
      };
      
      checkReady();
    });
  }

  /**
   * Get the prepared image info
   */
  getPreparedImage(imageRef: string): { localTag: string; cacheDir: string } | undefined {
    return this.preparedImages.get(imageRef);
  }

  /**
   * Remove a prepared image from podman when cache is cleared
   */
  async removePreparedImage(imageRef: string): Promise<void> {
    const prepared = this.preparedImages.get(imageRef);
    if (!prepared) {
      return;
    }

    if (!this.runtime.available) {
      this.preparedImages.delete(imageRef);
      return;
    }

    const cmd = this.runtime.type;
    try {
      logger.info('Removing prepared image from container runtime', { imageRef, localTag: prepared.localTag });
      execSync(`${cmd} rmi -f ${prepared.localTag}`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('Prepared image removed', { imageRef, localTag: prepared.localTag });
    } catch (err) {
      logger.debug('Failed to remove prepared image', { imageRef, error: (err as Error).message });
    }

    this.preparedImages.delete(imageRef);

    // Prune dangling layers/images to reclaim storage
    await this.pruneUnused();
  }

  /**
   * Force-remove an image by tag from the container runtime.
   * Used for cleanup when the preparedImages map may not have the entry
   * (e.g. after server restart). Uses rmi -f to handle running containers.
   */
  async forceRemoveImage(imageTag: string): Promise<void> {
    if (!this.runtime.available) {
      return;
    }

    const cmd = this.runtime.type;
    try {
      execSync(`${cmd} rmi -f ${imageTag}`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('Force-removed image from container runtime', { imageTag });
    } catch (err) {
      // Image may not exist, that's fine
      logger.debug('Force-remove image skipped (not found or error)', { imageTag, error: (err as Error).message });
    }
  }

  /**
   * Run podman/docker system prune to clean up all unused data.
   * Used when clearing the entire cache.
   */
  async systemPrune(): Promise<void> {
    if (!this.runtime.available) {
      return;
    }

    const cmd = this.runtime.type;
    try {
      logger.info(`Running ${cmd} system prune -a -f --volumes`);
      execSync(`${cmd} system prune -a -f --volumes`, {
        encoding: 'utf-8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('System prune completed');
    } catch (err) {
      logger.warn('System prune failed', { error: (err as Error).message });
    }
  }

  /**
   * Prune dangling/unused images to reclaim storage.
   * Lighter-weight than systemPrune - only removes unused images, not volumes.
   */
  async pruneUnused(): Promise<void> {
    if (!this.runtime.available) {
      return;
    }

    const cmd = this.runtime.type;
    try {
      logger.debug(`Running ${cmd} image prune -f`);
      execSync(`${cmd} image prune -f`, {
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.debug('Image prune completed');
    } catch (err) {
      logger.debug('Image prune failed', { error: (err as Error).message });
    }
  }

  /**
   * Clear all prepared/preparing state. Called when the entire cache is cleared
   * to prevent stale entries from blocking re-preparation of redownloaded images.
   */
  clearAllPreparedState(): void {
    logger.info('Clearing all prepared/preparing image state', {
      preparedCount: this.preparedImages.size,
      preparingCount: this.preparingImages.size
    });
    this.preparedImages.clear();
    this.preparingImages.clear();
  }
}

// Singleton instance
export const containerTerminalService = new ContainerTerminalService();
