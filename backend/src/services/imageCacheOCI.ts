import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import axios, { AxiosRequestConfig } from 'axios';
import tarStream from 'tar-stream';
import gunzip from 'gunzip-maybe';
import { pipeline } from 'stream';
import crypto from 'crypto';
import { createLogger, isDebugMode } from '../utils/logger';
import { APP_PATHS, settingsService } from './settings';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { containerTerminalService } from './containerTerminal';

const pipelineAsync = promisify(pipeline);
const logger = createLogger('ImageCache');

/**
 * Check if a host should bypass the proxy based on noProxy settings
 * Supports: exact match, wildcard (*.example.com, .example.com), and simple IP prefix matching
 */
function shouldBypassProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) {
    logger.debug('noProxy check: no noProxy configured', { host });
    return false;
  }
  
  const noProxyList = noProxy.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
  // Strip port from host for matching (noProxy typically doesn't include ports)
  const hostLower = host.toLowerCase().split(':')[0];
  
  logger.debug('noProxy check', { host, hostLower, noProxy, noProxyList, noProxyCount: noProxyList.length });
  
  for (const pattern of noProxyList) {
    // Strip port from pattern if present
    const patternHost = pattern.split(':')[0];
    
    logger.debug('noProxy comparing', { hostLower, patternHost, isMatch: hostLower === patternHost });
    
    // Exact match
    if (hostLower === patternHost) {
      logger.debug('noProxy match (exact)', { host, pattern });
      return true;
    }
    
    // Wildcard match (e.g., *.example.com or .example.com)
    if (patternHost.startsWith('*.')) {
      const suffix = patternHost.slice(1); // .example.com
      if (hostLower.endsWith(suffix) || hostLower === patternHost.slice(2)) {
        logger.debug('noProxy match (wildcard)', { host, pattern });
        return true;
      }
    } else if (patternHost.startsWith('.')) {
      if (hostLower.endsWith(patternHost) || hostLower === patternHost.slice(1)) {
        logger.debug('noProxy match (suffix)', { host, pattern });
        return true;
      }
    }
    
    // CIDR notation check (basic - just checks if pattern looks like IP range)
    // For simplicity, we do string prefix match for IP ranges like 192.168.
    if (patternHost.includes('/') || /^\d+\.\d+\./.test(patternHost)) {
      const prefix = patternHost.split('/')[0].replace(/\.\d+$/, '.');
      if (hostLower.startsWith(prefix)) {
        logger.debug('noProxy match (IP prefix)', { host, pattern, prefix });
        return true;
      }
    }
  }
  
  logger.debug('noProxy: no match found', { host, noProxyList });
  return false;
}

/**
 * Check if a registry should use HTTP instead of HTTPS
 * Matches the full host:port (e.g., registry.example.com:8083 is different from registry.example.com:8443)
 */
export function isInsecureRegistry(registry: string): boolean {
  const settings = settingsService.getSettings();
  const insecureRegistries = settings.insecureRegistries || [];
  const registryLower = registry.toLowerCase().trim();
  
  for (const insecure of insecureRegistries) {
    const insecureLower = insecure.toLowerCase().trim();
    if (!insecureLower) continue;
    
    // Exact match including port (e.g., registry:8083 matches registry:8083 but not registry:8443)
    if (registryLower === insecureLower) return true;
    
    // If insecure entry has no port, match any port on that host
    if (!insecureLower.includes(':') && registryLower.split(':')[0] === insecureLower) return true;
  }
  
  return false;
}

/**
 * Get the protocol to use for a registry (http or https)
 */
export function getRegistryProtocol(registry: string): 'http' | 'https' {
  const protocol = isInsecureRegistry(registry) ? 'http' : 'https';
  logger.debug('Registry protocol determined', { registry, protocol, isInsecure: protocol === 'http' });
  return protocol;
}

// Create an https agent that skips TLS verification for self-signed certs
// and optionally uses a proxy (respecting noProxy settings)
const getHttpsAgent = (targetHost?: string): https.Agent | undefined => {
  const settings = settingsService.getSettings();
  const proxyUrl = settings.httpProxy;
  
  logger.debug('getHttpsAgent called', { 
    targetHost, 
    proxyUrl: proxyUrl || '(not set)',
    noProxy: settings.noProxy || '(not set)',
    skipTlsVerify: settings.skipTlsVerify
  });
  
  // Check if this host should bypass proxy
  if (proxyUrl && targetHost && shouldBypassProxy(targetHost, settings.noProxy)) {
    logger.debug('BYPASSING proxy for HTTPS request - host in noProxy list', { targetHost, noProxy: settings.noProxy });
    // No proxy for this host, but still apply TLS settings
    if (settings.skipTlsVerify) {
      return new https.Agent({ rejectUnauthorized: false });
    }
    return undefined;
  }
  
  if (proxyUrl) {
    logger.debug('USING HTTPS proxy for request', { targetHost, proxyUrl, skipTlsVerify: settings.skipTlsVerify });
    // Use proxy agent with TLS settings
    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: !settings.skipTlsVerify
    });
    return agent;
  }
  
  logger.debug('NO proxy configured - direct connection', { targetHost, skipTlsVerify: settings.skipTlsVerify });
  if (settings.skipTlsVerify) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
};

// Get HTTP agent for non-TLS connections (with proxy support, respecting noProxy)
const getHttpAgent = (targetHost?: string): http.Agent | undefined => {
  const settings = settingsService.getSettings();
  const proxyUrl = settings.httpProxy;
  
  logger.debug('getHttpAgent called', { 
    targetHost, 
    proxyUrl: proxyUrl || '(not set)',
    noProxy: settings.noProxy || '(not set)'
  });
  
  // Check if this host should bypass proxy
  if (proxyUrl && targetHost && shouldBypassProxy(targetHost, settings.noProxy)) {
    logger.debug('BYPASSING proxy for HTTP request - host in noProxy list', { targetHost, noProxy: settings.noProxy });
    return undefined; // No proxy for this host
  }
  
  if (proxyUrl) {
    logger.debug('USING HTTP proxy for request', { targetHost, proxyUrl });
    return new HttpProxyAgent(proxyUrl);
  }
  
  logger.debug('NO proxy configured - direct connection', { targetHost });
  return undefined;
};

// Get axios config with proxy and TLS settings
export const getAxiosConfig = (targetHost?: string): Partial<AxiosRequestConfig> => {
  const config: Partial<AxiosRequestConfig> = {
    // CRITICAL: Disable axios's built-in proxy handling
    // When HTTPS_PROXY env var is set, axios tries to use its own proxy which conflicts
    // with our HttpsProxyAgent. Setting proxy: false ensures we only use our agent.
    proxy: false
  };
  const httpsAgent = getHttpsAgent(targetHost);
  const httpAgent = getHttpAgent(targetHost);
  
  if (httpsAgent) config.httpsAgent = httpsAgent;
  if (httpAgent) config.httpAgent = httpAgent;
  
  logger.debug('getAxiosConfig result', { 
    targetHost, 
    hasHttpsAgent: !!httpsAgent,
    httpsAgentType: httpsAgent?.constructor?.name,
    hasHttpAgent: !!httpAgent,
    httpAgentType: httpAgent?.constructor?.name,
    proxyDisabled: true
  });
  
  return config;
};

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  children?: FileNode[];
    mode?: string;
  uid?: number;
  gid?: number;
  mtime?: Date;
  linkname?: string;
}

interface ImageReference {
  registry: string;
  repository: string;
  tag: string;
  digest?: string;
  fullName: string;
}

export interface CachedImageData {
  imageRef: ImageReference;
  config: any;
  filesystem: FileNode;
  cachedAt: string;
  sizeBytes: number;  // Uncompressed filesystem size (for cache display)
  compressedSizeBytes?: number;  // Combined compressed layer sizes (what "docker images" shows)
  tarPath: string;
  digest?: string; // canonical config digest used to identify image content (Image ID)
  manifestDigest?: string; // Platform-specific manifest digest (for Kubernetes pod spec)
  indexDigest?: string; // Manifest list/index digest - what "docker images --digests" shows
}

type ManifestV2 = {
  schemaVersion: number;
  mediaType: string;
} & (
  | {
      // Single manifest
      config: { digest: string; size: number };
      layers: Array<{ digest: string; size: number; mediaType: string }>;
    }
  | {
      // Manifest list/index
      manifests: Array<{
        mediaType: string;
        size: number;
        digest: string;
        platform?: { architecture?: string; os?: string };
      }>;
    }
);

interface TarEntry {
  name: string;
  type: string;
  size: number;
  mode: number;
  uid: number;
  gid: number;
  mtime: Date;
  linkname?: string;
  data: Buffer;
}

// Lightweight entry without file data - for memory-efficient processing
interface TarEntryMeta {
  name: string;
  type: string;
  size: number;
  mode: number;
  uid: number;
  gid: number;
  mtime: Date;
  linkname?: string;
}

export class ImageCacheServiceOCI {
  private imageCache: Map<string, CachedImageData>;
  private lastTokenUsed: string | null = null;
  
  // Track images currently being downloaded (for terminal wait feature)
  private downloadsInProgress: Set<string> = new Set();

  // Dynamic getter to always read current cache directory from APP_PATHS
  private get cacheDir(): string {
    return APP_PATHS.cache;
  }

  constructor() {
    this.imageCache = new Map();
  }
  
  /**
   * Check if an image is currently being downloaded
   */
  isDownloadInProgress(imageRef: string): boolean {
    return this.downloadsInProgress.has(imageRef);
  }

  /**
   * Helper to perform logged GET requests. Uses centralized logger.
   * Only logs details in debug mode.
   */
  private maskHeadersForLog(headers: any, cred?: { username: string; password: string } | undefined) {
    const out: any = {};
    if (!headers) return out;
    for (const k of Object.keys(headers)) {
      const v = headers[k];
      if (!v) continue;
      // Mask Authorization header when basic auth is present via cred
      if (cred && (k.toLowerCase() === 'authorization' || k === 'Authorization')) {
        out[k] = 'Basic ***masked***';
        continue;
      }

      // Mask bearer tokens partially
      if (typeof v === 'string' && v.toLowerCase().startsWith('bearer ')) {
        const t = v.slice(7);
        out[k] = `Bearer ${t.slice(0, 6)}...`;
        continue;
      }

      out[k] = v;
    }
    return out;
  }

  private async loggedGet(url: string, config?: any, cred?: { username: string; password: string } | undefined) {
    try {
      const loggedHeaders = this.maskHeadersForLog(config?.headers, cred);
      logger.httpRequest('GET', url, loggedHeaders, cred ? { username: cred.username } : undefined);

      // Build axios config but do not overwrite provided Authorization header
      const axiosConfig = Object.assign({}, config || {});
      axiosConfig.validateStatus = axiosConfig.validateStatus || (() => true);
      
      // Always add User-Agent header (required by some proxies and registries)
      axiosConfig.headers = axiosConfig.headers || {};
      if (!axiosConfig.headers['User-Agent'] && !axiosConfig.headers['user-agent']) {
        axiosConfig.headers['User-Agent'] = 'container-image-compare/1.0';
      }
      
      if (cred && !(axiosConfig.headers && (axiosConfig.headers.Authorization || axiosConfig.headers.authorization))) {
        axiosConfig.auth = { username: cred.username, password: cred.password };
      }
      
      // Extract host from URL for proxy/noProxy configuration
      let targetHost: string | undefined;
      try {
        const urlObj = new URL(url);
        targetHost = urlObj.host; // includes port if specified
      } catch {
        // URL parsing failed, will use proxy for all requests
      }
      
      // Add agents for TLS verification and proxy settings (with noProxy check)
      const proxyConfig = getAxiosConfig(targetHost);
      Object.assign(axiosConfig, proxyConfig);

      const resp = await axios.get(url, axiosConfig);

      // Log response (only in debug mode via logger)
      let preview: string | undefined;
      if (resp && resp.data && typeof resp.data !== 'string' && typeof resp.data.pipe === 'function') {
        preview = '<stream>';
      } else if (resp.data) {
        try {
          const s = JSON.stringify(resp.data);
          preview = s?.length > 200 ? s.slice(0, 200) + '...' : s;
        } catch {
          preview = '<non-serializable>';
        }
      }
      logger.httpResponse(resp.status, url, preview);

      return resp;
    } catch (err: any) {
      // Capture and re-throw with descriptive error message for various errors
      const errMsg = err?.message || String(err);
      const errCode = err?.code || '';
      logger.error('HTTP request failed', { url, error: errMsg, code: errCode });
      
      // Extract target host from URL for error messages
      let targetHost = 'registry';
      try {
        const urlObj = new URL(url);
        targetHost = urlObj.host;
      } catch { /* ignore */ }
      
      // Handle DNS resolution errors
      if (errCode === 'ENOTFOUND' || errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
        const dnsError = new Error(`DNS lookup failed: Cannot resolve hostname '${targetHost}'. Check if the registry address is correct.`);
        (dnsError as any).code = 'DNS_ERROR';
        (dnsError as any).originalError = errMsg;
        throw dnsError;
      }
      
      // Handle connection refused errors
      if (errCode === 'ECONNREFUSED' || errMsg.includes('ECONNREFUSED')) {
        const connError = new Error(`Connection refused: Unable to connect to ${targetHost}. The server may be down or not accepting connections.`);
        (connError as any).code = 'CONNECTION_REFUSED';
        (connError as any).originalError = errMsg;
        throw connError;
      }
      
      // Handle connection reset errors  
      if (errCode === 'ECONNRESET' || errMsg.includes('ECONNRESET')) {
        const resetError = new Error(`Connection reset: The connection to ${targetHost} was unexpectedly closed. This may be a proxy or firewall issue.`);
        (resetError as any).code = 'CONNECTION_RESET';
        (resetError as any).originalError = errMsg;
        throw resetError;
      }
      
      // Handle timeout errors
      if (errCode === 'ETIMEDOUT' || errCode === 'ESOCKETTIMEDOUT' || errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
        const timeoutError = new Error(`Connection timeout: Unable to reach ${targetHost} within the time limit. Check network connectivity or proxy settings.`);
        (timeoutError as any).code = 'TIMEOUT';
        (timeoutError as any).originalError = errMsg;
        throw timeoutError;
      }
      
      // Handle network unreachable errors
      if (errCode === 'ENETUNREACH' || errCode === 'EHOSTUNREACH' || errMsg.includes('ENETUNREACH') || errMsg.includes('EHOSTUNREACH')) {
        const unreachError = new Error(`Network unreachable: Cannot reach ${targetHost}. Check your network connection and proxy settings.`);
        (unreachError as any).code = 'NETWORK_UNREACHABLE';
        (unreachError as any).originalError = errMsg;
        throw unreachError;
      }
      
      // Wrap SSL/TLS errors with more context
      if (errMsg.includes('self-signed') || errMsg.includes('certificate') || errMsg.includes('CERT_') || errMsg.includes('UNABLE_TO_VERIFY')) {
        const sslError = new Error(`SSL/TLS error connecting to ${targetHost}: ${errMsg}. Try enabling 'Skip TLS Verification' in Settings.`);
        (sslError as any).code = 'SSL_ERROR';
        (sslError as any).originalError = errMsg;
        throw sslError;
      }
      
      // Handle proxy-related errors
      if (errMsg.includes('proxy') || errMsg.includes('Proxy') || errMsg.includes('PROXY') || errCode === 'EPIPE') {
        const proxyError = new Error(`Proxy error connecting to ${targetHost}: ${errMsg}. Check proxy configuration in Settings.`);
        (proxyError as any).code = 'PROXY_ERROR';
        (proxyError as any).originalError = errMsg;
        throw proxyError;
      }
      
      // For any other errors, include the original message
      const genericError = new Error(`Failed to connect to ${targetHost}: ${errMsg}`);
      (genericError as any).code = errCode || 'UNKNOWN';
      (genericError as any).originalError = errMsg;
      throw genericError;
    }
  }

  async init(): Promise<void> {
    // Cache directory is created lazily when needed (in downloadAndCacheImage)
    // This avoids creating the default directory when a custom location is configured
  }

  /**
   * Get cache statistics including total size and entry count
   */
  async getCacheStats(): Promise<{ totalSizeBytes: number; totalSizeGB: number; podmanSizeBytes: number; podmanSizeGB: number; combinedSizeBytes: number; combinedSizeGB: number; entryCount: number; entries: Array<{ dir: string; sizeBytes: number; lastModified: Date; imageRefs: string[]; cacheDir: string }> }> {
    let totalSize = 0;
    let entryCount = 0;
    const entries: Array<{ dir: string; sizeBytes: number; lastModified: Date; imageRefs: string[]; cacheDir: string }> = [];

    try {
      const dirs = await fs.promises.readdir(this.cacheDir);
      for (const dir of dirs) {
        const dirPath = path.join(this.cacheDir, dir);
        const stat = await fs.promises.stat(dirPath);
        if (!stat.isDirectory()) continue;

        const refsPath = path.join(dirPath, 'refs.json');

        let entrySize = 0;
        let lastModified = stat.mtime;
        let imageRefs: string[] = [];

        // Recursively sum all file sizes within the cache entry directory
        // This captures filesystem.tar, config.json, docker-image.tar, layers/*, etc.
        entrySize = await this.getDirSize(dirPath);

        // Get the latest modification time from key files
        for (const fname of ['filesystem.tar', 'config.json', 'docker-image.tar']) {
          const fpath = path.join(dirPath, fname);
          try {
            const fstat = await fs.promises.stat(fpath);
            if (fstat.mtime > lastModified) lastModified = fstat.mtime;
          } catch {
            // File doesn't exist, skip
          }
        }

        // Read image refs from refs.json if it exists
        if (fs.existsSync(refsPath)) {
          try {
            const refsData = JSON.parse(await fs.promises.readFile(refsPath, 'utf-8'));
            // refs.json can be either a plain array or an object with imageRefs property
            imageRefs = Array.isArray(refsData) ? refsData : (refsData.imageRefs || []);
          } catch {
            // Ignore parse errors
          }
        }

        if (entrySize > 0) {
          totalSize += entrySize;
          entryCount++;
          entries.push({ dir, sizeBytes: entrySize, lastModified, imageRefs, cacheDir: dirPath });
        }
      }
    } catch (err) {
      logger.debug('Error getting cache stats', { error: (err as Error).message });
    }

    // Also measure Podman storage directory size
    let podmanSize = 0;
    try {
      const podmanStorageDir = path.join(path.dirname(this.cacheDir), 'podman', 'storage');
      if (fs.existsSync(podmanStorageDir)) {
        podmanSize = await this.getDirSize(podmanStorageDir);
      }
    } catch (err) {
      logger.debug('Error getting podman storage size', { error: (err as Error).message });
    }

    const combinedSize = totalSize + podmanSize;

    return {
      totalSizeBytes: totalSize,
      totalSizeGB: totalSize / (1024 * 1024 * 1024),
      podmanSizeBytes: podmanSize,
      podmanSizeGB: podmanSize / (1024 * 1024 * 1024),
      combinedSizeBytes: combinedSize,
      combinedSizeGB: combinedSize / (1024 * 1024 * 1024),
      entryCount,
      entries: entries.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime()) // oldest first
    };
  }

  /**
   * Recursively calculate total size of all files in a directory
   */
  private async getDirSize(dirPath: string): Promise<number> {
    let totalSize = 0;
    try {
      const items = await fs.promises.readdir(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = await fs.promises.stat(itemPath);
        if (stat.isDirectory()) {
          totalSize += await this.getDirSize(itemPath);
        } else {
          totalSize += stat.size;
        }
      }
    } catch {
      // Ignore errors (permission, missing files, etc.)
    }
    return totalSize;
  }

  /**
   * Enforce max cache size by removing oldest entries
   */
  async enforceCacheLimit(maxSizeGB: number): Promise<{ removedCount: number; freedBytes: number }> {
    const stats = await this.getCacheStats();
    const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;

    let removedCount = 0;
    let freedBytes = 0;
    // Use combined size (cache + podman storage) for limit enforcement
    let currentSize = stats.combinedSizeBytes;

    // Remove oldest entries until under limit
    for (const entry of stats.entries) {
      if (currentSize <= maxSizeBytes) break;

      const dirPath = path.join(this.cacheDir, entry.dir);
      try {
        // Remove associated podman/docker images before deleting cache
        await this.removePodmanImagesForCacheDir(dirPath);

        // Use recursive delete to handle subdirectories like layers/
        await this.deleteDirRecursive(dirPath);

        currentSize -= entry.sizeBytes;
        freedBytes += entry.sizeBytes;
        removedCount++;

        logger.info('Removed cache entry for space', { dir: entry.dir, freedMB: (entry.sizeBytes / 1024 / 1024).toFixed(2) });
      } catch (err) {
        logger.debug('Failed to remove cache entry', { dir: entry.dir, error: (err as Error).message });
      }
    }

    // Also clear memory cache entries that no longer exist on disk
    for (const [key, cached] of this.imageCache.entries()) {
      if (!fs.existsSync(cached.tarPath)) {
        this.imageCache.delete(key);
      }
    }

    return { removedCount, freedBytes };
  }

  /**
   * Clear entire cache
   */
  async clearCache(): Promise<{ removedCount: number; freedBytes: number }> {
    const stats = await this.getCacheStats();
    let removedCount = 0;
    let freedBytes = 0;

    // Remove all podman/docker images for each cache entry
    for (const entry of stats.entries) {
      const dirPath = path.join(this.cacheDir, entry.dir);
      try {
        await this.removePodmanImagesForCacheDir(dirPath);
      } catch (err) {
        logger.debug('Failed to remove podman images for cache entry', { dir: entry.dir, error: (err as Error).message });
      }
    }

    // Run system prune to clean up all unused podman/docker data
    try {
      await containerTerminalService.systemPrune();
    } catch (err) {
      logger.debug('System prune failed during cache clear', { error: (err as Error).message });
    }

    // Clear all prepared/preparing state to prevent stale entries from blocking
    // re-preparation of redownloaded images
    containerTerminalService.clearAllPreparedState();

    for (const entry of stats.entries) {
      const dirPath = path.join(this.cacheDir, entry.dir);
      try {
        // Use recursive delete to handle subdirectories like layers/
        const bytesFreed = await this.deleteDirRecursive(dirPath);
        freedBytes += bytesFreed;
        removedCount++;
      } catch (err) {
        logger.debug('Failed to remove cache entry', { dir: entry.dir, error: (err as Error).message });
      }
    }

    // Clear memory cache
    this.imageCache.clear();

    logger.info('Cache cleared', { removedCount, freedGB: (freedBytes / 1024 / 1024 / 1024).toFixed(2) });
    return { removedCount, freedBytes };
  }

  /**
   * Delete a single cache entry by its directory name
   */
  async deleteCacheEntry(dirName: string): Promise<{ success: boolean; freedBytes: number }> {
    const dirPath = path.join(this.cacheDir, dirName);

    if (!fs.existsSync(dirPath)) {
      logger.debug('Cache entry not found', { dirName });
      return { success: false, freedBytes: 0 };
    }

    let freedBytes = 0;
    try {
      // Remove all associated podman/docker images (reads from memory + disk refs.json)
      await this.removePodmanImagesForCacheDir(dirPath);

      // Recursively calculate size and delete all contents (including subdirectories like layers/)
      freedBytes = await this.deleteDirRecursive(dirPath);

      // Remove from memory cache if present
      for (const [key, cached] of this.imageCache.entries()) {
        if (cached.tarPath.includes(dirName)) {
          this.imageCache.delete(key);
        }
      }

      logger.info('Cache entry deleted', { dirName, freedGB: (freedBytes / 1024 / 1024 / 1024).toFixed(2) });
      return { success: true, freedBytes };
    } catch (err) {
      logger.error('Failed to delete cache entry', { dirName, error: (err as Error).message });
      return { success: false, freedBytes: 0 };
    }
  }

  /**
   * Remove all podman/docker images associated with a cache directory.
   * Reads refs from both in-memory cache and disk refs.json, and also
   * tries removing by the cic-terminal/<dirName>:latest tag pattern.
   */
  private async removePodmanImagesForCacheDir(dirPath: string): Promise<void> {
    const dirName = path.basename(dirPath);
    const imageRefsToClean: string[] = [];

    // Collect refs from in-memory cache
    for (const [key, cached] of this.imageCache.entries()) {
      if (cached.tarPath.includes(dirName)) {
        imageRefsToClean.push(key);
      }
    }

    // Collect refs from disk refs.json (covers server restarts / images not in memory)
    try {
      const refsPath = path.join(dirPath, 'refs.json');
      if (fs.existsSync(refsPath)) {
        const diskRefs = JSON.parse(await fs.promises.readFile(refsPath, 'utf-8'));
        if (Array.isArray(diskRefs)) {
          for (const ref of diskRefs) {
            if (!imageRefsToClean.includes(ref)) {
              imageRefsToClean.push(ref);
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    // Remove via containerTerminalService (checks preparedImages map)
    for (const imageRef of imageRefsToClean) {
      try {
        await containerTerminalService.removePreparedImage(imageRef);
      } catch (err) {
        logger.debug('Failed to remove prepared image from container runtime', { imageRef, error: (err as Error).message });
      }
    }

    // Also try removing by the cic-terminal/<dirName>:latest tag directly
    // This handles cases where preparedImages map was lost (e.g. server restart)
    try {
      const localTag = `cic-terminal/${dirName}:latest`;
      await containerTerminalService.forceRemoveImage(localTag);
    } catch (err) {
      logger.debug('Failed to force-remove cic-terminal image', { dirName, error: (err as Error).message });
    }
  }

  /**
   * Recursively delete a directory and all its contents, returning total bytes freed
   */
  private async deleteDirRecursive(dirPath: string): Promise<number> {
    let freedBytes = 0;
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        freedBytes += await this.deleteDirRecursive(entryPath);
      } else {
        const stat = await fs.promises.stat(entryPath);
        freedBytes += stat.size;
        await fs.promises.unlink(entryPath);
      }
    }
    
    await fs.promises.rmdir(dirPath);
    return freedBytes;
  }

  /**
   * Update refs.json in a cache directory to track which imageRefs are stored there
   */
  private async updateCacheRefs(imageCacheDir: string, imageRef: string): Promise<void> {
    const refsPath = path.join(imageCacheDir, 'refs.json');
    let refs: string[] = [];
    
    try {
      if (fs.existsSync(refsPath)) {
        refs = JSON.parse(await fs.promises.readFile(refsPath, 'utf-8'));
      }
    } catch {
      refs = [];
    }
    
    if (!refs.includes(imageRef)) {
      refs.push(imageRef);
      await fs.promises.writeFile(refsPath, JSON.stringify(refs, null, 2));
      logger.debug('Updated refs.json', { imageCacheDir, imageRef, totalRefs: refs.length });
    }
  }

  /**
   * Save digest information to disk for later retrieval
   */
  private async saveDigests(imageCacheDir: string, digests: { digest?: string; manifestDigest?: string; indexDigest?: string; compressedSizeBytes?: number }): Promise<void> {
    const digestsPath = path.join(imageCacheDir, 'digests.json');
    await fs.promises.writeFile(digestsPath, JSON.stringify(digests, null, 2));
    logger.debug('Saved digests.json', { imageCacheDir, digests });
  }

  /**
   * Load digest information from disk
   */
  private async loadDigests(imageCacheDir: string): Promise<{ digest?: string; manifestDigest?: string; indexDigest?: string; compressedSizeBytes?: number }> {
    const digestsPath = path.join(imageCacheDir, 'digests.json');
    try {
      if (fs.existsSync(digestsPath)) {
        return JSON.parse(await fs.promises.readFile(digestsPath, 'utf-8'));
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return {};
  }

  getCachedImageByDigest(digest: string): CachedImageData | undefined {
    for (const cached of this.imageCache.values()) {
      if (cached.digest && cached.digest === digest) return cached;
    }
    return undefined;
  }

  /**
   * Check if an image is cached (either in memory or on disk)
   * Returns true if the image cache directory exists and has the filesystem.tar file
   */
  async isImageCached(imageRef: string): Promise<boolean> {
    // Check memory cache first
    if (this.imageCache.has(imageRef)) {
      const cached = this.imageCache.get(imageRef)!;
      if (fs.existsSync(cached.tarPath)) {
        return true;
      }
    }
    
    // Check disk cache - look through refs.json files
    try {
      const dirs = await fs.promises.readdir(this.cacheDir);
      for (const dir of dirs) {
        const refsPath = path.join(this.cacheDir, dir, 'refs.json');
        const tarPath = path.join(this.cacheDir, dir, 'filesystem.tar');
        
        if (fs.existsSync(refsPath) && fs.existsSync(tarPath)) {
          try {
            const refsData = JSON.parse(await fs.promises.readFile(refsPath, 'utf-8'));
            const refs = Array.isArray(refsData) ? refsData : (refsData.imageRefs || []);
            if (refs.includes(imageRef)) {
              return true;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch {
      // Cache dir doesn't exist or isn't readable
    }
    
    return false;
  }

  /**
   * Get cached image from memory cache only (synchronous, no disk/network).
   * Returns undefined if image is not in memory cache.
   * Use this for local file operations that don't need authentication.
   */
  getCachedImageFromMemory(imageRef: string): CachedImageData | undefined {
    // Check memory cache first
    if (this.imageCache.has(imageRef)) {
      const cached = this.imageCache.get(imageRef)!;
      if (fs.existsSync(cached.tarPath)) {
        return cached;
      }
    }
    return undefined;
  }

  removeCachedImageKey(key: string) {
    const cached = this.imageCache.get(key);
    this.imageCache.delete(key);
    try {
      if (cached && cached.tarPath) {
        const cfg = path.join(path.dirname(cached.tarPath), 'config.json');
        if (fs.existsSync(cached.tarPath)) {
          try { fs.unlinkSync(cached.tarPath); } catch (e) { /* ignore */ }
        }
        if (fs.existsSync(cfg)) {
          try { fs.unlinkSync(cfg); } catch (e) { /* ignore */ }
        }
        // Optionally remove the directory if empty
        try {
          const dir = path.dirname(cached.tarPath);
          const files = fs.readdirSync(dir);
          if (files.length === 0) {
            fs.rmdirSync(dir);
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // Non-fatal cleanup error
      logger.warn('Cache cleanup error', { error: (e as any)?.message });
    }
  }

  /**
   * Parse image reference into registry, repository, and tag
   * Handles formats like:
   * - nginx:latest
   * - library/nginx:latest
   * - docker.io/library/nginx:latest
   * - myregistry.com:5000/myrepo/myimage:v1.0
   * - registry.example.com/repo/image@sha256:abcdef...
   */
  private parseImageRef(imageRef: string): { registry: string; repository: string; tag: string } {
    let registry = 'registry-1.docker.io';
    let repository: string;
    let tag = 'latest';

    let repoPath = imageRef;

    // Check for digest reference (@sha256:...) before tag parsing
    // The @ separator takes precedence over : for tag
    const atIdx = imageRef.indexOf('@sha256:');
    if (atIdx !== -1) {
      tag = imageRef.substring(atIdx + 1); // "sha256:abcdef..."
      repoPath = imageRef.substring(0, atIdx);
    } else {
      // Find the last colon that represents a tag (not a port)
      // Strategy: split by '/', check if the last segment has a colon (that's the tag)
      const segments = imageRef.split('/');
      const lastSegment = segments[segments.length - 1];

      if (lastSegment.includes(':')) {
        // The last segment has a colon - this is the tag separator
        const colonIdx = lastSegment.lastIndexOf(':');
        tag = lastSegment.substring(colonIdx + 1);
        segments[segments.length - 1] = lastSegment.substring(0, colonIdx);
        repoPath = segments.join('/');
      }
    }

    // Now parse registry from repoPath
    const parts = repoPath.split('/');

    // Check if first part is a registry (has a dot or colon for port, or is localhost)
    const firstPart = parts[0];
    const isRegistry = firstPart.includes('.') ||
                       firstPart.includes(':') ||
                       firstPart === 'localhost';

    if (parts.length > 1 && isRegistry) {
      registry = parts[0];
      repository = parts.slice(1).join('/');
    } else {
      repository = repoPath;
      // Docker Hub requires 'library/' prefix for official images
      if (!repository.includes('/')) {
        repository = `library/${repository}`;
      }
    }

    return { registry, repository, tag };
  }

  /**
   * Get the protocol to use for a specific registry
   */
  private getProtocol(registry: string): 'http' | 'https' {
    return getRegistryProtocol(registry);
  }

  /**
   * Get authentication token for registry
   */
  private async getAuthToken(registry: string, repository: string): Promise<string | null> {
    try {
      const protocol = this.getProtocol(registry);
      const authUrl = registry === 'registry-1.docker.io'
        ? `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`
        : `${protocol}://${registry}/v2/token?service=${registry}&scope=repository:${repository}:pull`;

      const response = await this.loggedGet(authUrl);
      return response.data?.token || response.data?.access_token || null;
    } catch (error) {
      logger.debug('No auth required or auth failed', { error: (error as any)?.message });
      return null;
    }
  }

  /**
   * Check registry /v2/ endpoint to get authentication requirements.
   * This is how Docker CLI discovers auth info - it's more reliable through proxies.
   */
  private async getRegistryAuthInfo(registry: string): Promise<{ realm: string; service: string } | null> {
    try {
      const protocol = this.getProtocol(registry);
      const url = `${protocol}://${registry}/v2/`;
      logger.debug('Checking registry auth info via /v2/', { url });
      
      const resp = await this.loggedGet(url, { validateStatus: () => true });
      logger.debug('Registry /v2/ response', { status: resp.status, headers: resp.headers ? Object.keys(resp.headers) : [] });
      
      // 401 with WWW-Authenticate header tells us how to authenticate
      if (resp.status === 401) {
        const www = resp.headers?.['www-authenticate'] || resp.headers?.['WWW-Authenticate'];
        if (www && typeof www === 'string') {
          const realmMatch = www.match(/realm="([^"]+)"/i) || www.match(/realm=([^,\s]+)/i);
          const serviceMatch = www.match(/,\s*service="([^"]+)"/i) || www.match(/,\s*service=([^,\s"]+)/i);
          const realm = realmMatch ? realmMatch[1] : null;
          const service = serviceMatch ? serviceMatch[1] : (registry === 'registry-1.docker.io' ? 'registry.docker.io' : registry);
          
          if (realm) {
            logger.debug('Got auth info from /v2/', { realm, service });
            return { realm, service };
          }
        }
      }
      
      // 200 means no auth required
      if (resp.status === 200) {
        logger.debug('Registry /v2/ returned 200 - no auth required');
        return null;
      }
      
      logger.debug('Registry /v2/ returned unexpected status', { status: resp.status });
      return null;
    } catch (err) {
      logger.debug('Failed to get registry auth info', { error: (err as any)?.message });
      return null;
    }
  }

  private async getAuthTokenWithCred(registry: string, repository: string, username: string, password: string): Promise<string | null> {
    try {
      const protocol = this.getProtocol(registry);
      const authUrl = registry === 'registry-1.docker.io'
        ? `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`
        : `${protocol}://${registry}/v2/token?service=${registry}&scope=repository:${repository}:pull`;

      const response = await this.loggedGet(authUrl, { auth: { username, password } }, { username, password });

      return response.data?.token || response.data?.access_token || null;
    } catch (error) {
      logger.debug('Auth with credentials failed', { error: (error as any)?.message });
      return null;
    }
  }

  private async fetchTokenFromRealmWithCred(realm: string, service: string, repository: string, username: string, password: string): Promise<string | null> {
    try {
      // Build token URL with service & scope if not present in realm URL
      // Use the service parameter directly as it should be extracted from WWW-Authenticate
      let url = realm;
      if (!realm.includes('?')) {
        url = `${realm}?service=${encodeURIComponent(service)}&scope=repository:${repository}:pull`;
      } else if (!realm.includes('service=')) {
        url = `${realm}&service=${encodeURIComponent(service)}&scope=repository:${repository}:pull`;
      } else if (!realm.includes('scope=')) {
        url = `${realm}&scope=repository:${repository}:pull`;
      }
      logger.debug('Fetching token from realm', { url, username });
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      const resp = await this.loggedGet(url, { headers: { Authorization: authHeader }, validateStatus: () => true }, { username, password });
      logger.debug('Token endpoint response', { status: resp.status });
      if (resp.status === 200 && (resp.data?.token || resp.data?.access_token)) {
        logger.debug('Token obtained successfully', { username });
        return resp.data.token || resp.data.access_token;
      }
      logger.debug('Token fetch returned non-200', { status: resp.status });
      return null;
    } catch (err) {
      logger.debug('Token fetch failed', { error: (err as any)?.message });
      return null;
    }
  }

  /**
   * Download image manifest
   * Returns both manifestDigest (platform-specific) and indexDigest (manifest list digest if applicable)
   */
  private async downloadManifest(registry: string, repository: string, tag: string, token: string | null): Promise<{ manifest: any; manifestDigest: string | null; indexDigest: string | null }> {
    const protocol = this.getProtocol(registry);
    const url = `${protocol}://${registry}/v2/${repository}/manifests/${tag}`;
    const headers: any = {
      // Accept manifest list/index types first, then single-platform manifests
      'Accept': 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Request as text to preserve exact bytes for digest computation
    const response = await this.loggedGet(url, { headers, validateStatus: () => true, responseType: 'text' });
    logger.debug('downloadManifest response', { 
      status: response.status, 
      hasToken: !!token,
      contentDigest: response.headers?.['docker-content-digest'] || 'MISSING',
      contentType: response.headers?.['content-type']
    });
    if (response.status === 401) {
      logger.debug('Manifest request returned 401', { url, registry, repository });
      // Extract error details from response body if available
      let errorDetail = '';
      try {
        const errBody = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (errBody?.errors?.[0]?.message) {
          errorDetail = errBody.errors[0].message;
        } else if (errBody?.message) {
          errorDetail = errBody.message;
        }
      } catch { /* ignore parse errors */ }
      
      const www = response.headers?.['www-authenticate'] || response.headers?.['WWW-Authenticate'];
      if (www && typeof www === 'string' && www.toLowerCase().includes('bearer')) {
        // Extract realm URL and service from header
        // Format: Bearer realm="https://...",service="docker-registry",scope="..."
        // Note: realm may contain "service" in the URL path, so we need a precise regex for the service parameter
        const realmMatch = www.match(/realm="([^"]+)"/i) || www.match(/realm=([^,\s]+)/i);
        const serviceMatch = www.match(/,\s*service="([^"]+)"/i) || www.match(/,\s*service=([^,\s"]+)/i);
        const realm = realmMatch ? realmMatch[1] : null;
        const service = serviceMatch ? serviceMatch[1] : (registry === 'registry-1.docker.io' ? 'registry.docker.io' : registry);
        
        logger.debug('Parsed WWW-Authenticate', { realm, service, www: www.slice(0, 200) });

        if (realm) {
          try {
            // Try anonymous token first using the service from WWW-Authenticate
            const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=repository:${repository}:pull`;
            logger.debug('Trying anonymous token', { tokenUrl, service });
            let tokenResp = await this.loggedGet(tokenUrl, { validateStatus: () => true });
            if (tokenResp.status === 401) {
              // token endpoint requires auth — return null to caller to let credential flow attempt
            } else if (tokenResp.data && (tokenResp.data.token || tokenResp.data.access_token)) {
              const t = tokenResp.data.token || tokenResp.data.access_token;
              this.lastTokenUsed = t;
              headers['Authorization'] = `Bearer ${t}`;
              // Request as text to preserve exact bytes for digest computation
              const retry = await this.loggedGet(url, { headers, validateStatus: () => true, responseType: 'text' });
              if (retry.status === 401) {
                let retryErrorDetail = errorDetail;
                try {
                  const retryErrBody = typeof retry.data === 'string' ? JSON.parse(retry.data) : retry.data;
                  if (retryErrBody?.errors?.[0]?.message) retryErrorDetail = retryErrBody.errors[0].message;
                  else if (retryErrBody?.message) retryErrorDetail = retryErrBody.message;
                } catch { /* ignore */ }
                throw new AuthError(`Authentication required for ${registry}${retryErrorDetail ? ': ' + retryErrorDetail : ''}`, { registry, repository, reason: 'manifest', originalError: retryErrorDetail || 'HTTP 401' });
              }
              // Handle other error statuses
              if (retry.status >= 400) {
                const retryErrText = typeof retry.data === 'string' ? retry.data : JSON.stringify(retry.data);
                throw new Error(`Registry request failed (HTTP ${retry.status}): ${retryErrText.slice(0, 200)}`);
              }
              // Get raw manifest text and compute digest from it
              const rawRetryManifest: string = retry.data;
              let retryManifestDigest = retry.headers?.['docker-content-digest'] || null;
              if (!retryManifestDigest && rawRetryManifest) {
                retryManifestDigest = 'sha256:' + crypto.createHash('sha256').update(rawRetryManifest).digest('hex');
                logger.debug('Computed retry manifest digest from raw content (header missing)', { computedDigest: retryManifestDigest.slice(0, 30) });
              }
              let retryData: any;
              try {
                retryData = typeof rawRetryManifest === 'string' ? JSON.parse(rawRetryManifest) : rawRetryManifest;
              } catch (parseErr) {
                throw new Error(`Invalid manifest response (not JSON): ${rawRetryManifest?.slice(0, 200)}`);
              }
              
              // Check if it's a manifest list and handle accordingly
              if (retryData.manifests && Array.isArray(retryData.manifests)) {
                const manifests = retryData.manifests as Array<any>;
                let chosen = manifests.find(m => m.platform && m.platform.os === 'linux' && (m.platform.architecture === 'amd64' || m.platform.architecture === 'x86_64'));
                if (!chosen) chosen = manifests.find(m => m.platform && m.platform.os === 'linux');
                if (!chosen) chosen = manifests[0];
                
                const chosenDigest = chosen.digest;
                const chosenResp = await this.loggedGet(`${protocol}://${registry}/v2/${repository}/manifests/${chosenDigest}`, { headers, validateStatus: () => true, responseType: 'text' });
                if (chosenResp.status === 401) {
                  let chosenErrorDetail = '';
                  try {
                    const errBody = typeof chosenResp.data === 'string' ? JSON.parse(chosenResp.data) : chosenResp.data;
                    if (errBody?.errors?.[0]?.message) chosenErrorDetail = errBody.errors[0].message;
                    else if (errBody?.message) chosenErrorDetail = errBody.message;
                  } catch { /* ignore */ }
                  throw new AuthError(`Authentication required for ${registry}${chosenErrorDetail ? ': ' + chosenErrorDetail : ''}`, { registry, repository, reason: 'manifest', originalError: chosenErrorDetail || 'HTTP 401' });
                }
                if (chosenResp.status >= 400) {
                  const chosenErrText = typeof chosenResp.data === 'string' ? chosenResp.data : JSON.stringify(chosenResp.data);
                  throw new Error(`Registry request failed (HTTP ${chosenResp.status}): ${chosenErrText.slice(0, 200)}`);
                }
                const rawChosenManifest: string = chosenResp.data;
                let chosenManifestDigest = chosenResp.headers?.['docker-content-digest'] || null;
                // Compute from raw bytes if header missing - use chosenDigest from manifest list as fallback
                if (!chosenManifestDigest && rawChosenManifest) {
                  chosenManifestDigest = 'sha256:' + crypto.createHash('sha256').update(rawChosenManifest).digest('hex');
                } else if (!chosenManifestDigest) {
                  chosenManifestDigest = chosenDigest;
                }
                let chosenData: any;
                try {
                  chosenData = typeof rawChosenManifest === 'string' ? JSON.parse(rawChosenManifest) : rawChosenManifest;
                } catch (parseErr) {
                  throw new Error(`Invalid manifest response (not JSON): ${rawChosenManifest?.slice(0, 200)}`);
                }
                return { manifest: chosenData, manifestDigest: chosenManifestDigest, indexDigest: retryManifestDigest };
              }
              
              // Single-platform image
              return { manifest: retryData, manifestDigest: retryManifestDigest, indexDigest: retryManifestDigest };
            }
          } catch (err) {
            // Capture error for better reporting
            const catchErr = err as any;
            if (catchErr?.name === 'AuthError') throw catchErr; // Re-throw AuthError as-is
            // Log the caught error for debugging
            logger.debug('Token flow error', { error: catchErr?.message });
          }
          // If we have credentials available (the higher level should provide them via getAuthTokenWithCred), let caller handle credentialed token
        }
      }
      throw new AuthError(`Authentication required for ${registry}${errorDetail ? ': ' + errorDetail : ''}`, { registry, repository, reason: 'manifest', originalError: errorDetail || 'HTTP 401' });
    }
    
    // Handle other error responses (4xx, 5xx) before trying to parse JSON
    if (response.status >= 400) {
      const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const statusText = response.status === 400 ? 'Bad Request' : 
                         response.status === 403 ? 'Forbidden' :
                         response.status === 404 ? 'Not Found' :
                         response.status === 407 ? 'Proxy Authentication Required' :
                         response.status === 502 ? 'Bad Gateway (proxy error)' :
                         response.status === 503 ? 'Service Unavailable' :
                         `HTTP ${response.status}`;
      throw new Error(`Registry request failed: ${statusText} - ${errorText.slice(0, 200)}`);
    }
    
    // Capture Docker-Content-Digest header from successful response - this is the index digest if manifest list
    // Some registries (like Harbor) may not return this header, so we compute it from the raw manifest bytes
    const rawManifest: string = response.data;
    let topLevelDigest = response.headers?.['docker-content-digest'] || null;
    
    // If header is missing, compute digest from raw manifest bytes (not re-serialized JSON)
    if (!topLevelDigest && rawManifest) {
      topLevelDigest = 'sha256:' + crypto.createHash('sha256').update(rawManifest).digest('hex');
      logger.debug('Computed manifest digest from raw content (header missing)', { computedDigest: topLevelDigest.slice(0, 30) });
    }
    
    // Parse the manifest JSON
    let data: any;
    try {
      data = typeof rawManifest === 'string' ? JSON.parse(rawManifest) : rawManifest;
    } catch (parseErr) {
      // Response was not valid JSON - likely an error page from proxy or registry
      const preview = rawManifest?.slice(0, 200) || '(empty response)';
      throw new Error(`Invalid response from registry (not JSON): ${preview}`);
    }

    // If it's a manifest list (index), choose a suitable manifest for linux/amd64 if available
    if ((data as any).manifests && Array.isArray((data as any).manifests)) {
      const manifests = (data as any).manifests as Array<any>;
      // Try to pick linux + amd64 first
      let chosen = manifests.find(m => m.platform && m.platform.os === 'linux' && (m.platform.architecture === 'amd64' || m.platform.architecture === 'x86_64'));
      if (!chosen) {
        // Fallback to any linux
        chosen = manifests.find(m => m.platform && m.platform.os === 'linux');
      }
      if (!chosen) {
        // Fallback to first manifest
        chosen = manifests[0];
      }

      // Fetch the chosen manifest as a normal manifest - the chosen manifest digest is what we want
      const chosenDigest = chosen.digest;
      const chosenResp = await this.loggedGet(`${protocol}://${registry}/v2/${repository}/manifests/${chosenDigest}`, { headers, validateStatus: () => true, responseType: 'text' });
      if (chosenResp.status === 401) {
        let chosenErrorDetail = '';
        try {
          const errBody = typeof chosenResp.data === 'string' ? JSON.parse(chosenResp.data) : chosenResp.data;
          if (errBody?.errors?.[0]?.message) chosenErrorDetail = errBody.errors[0].message;
          else if (errBody?.message) chosenErrorDetail = errBody.message;
        } catch { /* ignore */ }
        throw new AuthError(`Authentication required for ${registry}${chosenErrorDetail ? ': ' + chosenErrorDetail : ''}`, { registry, repository, reason: 'manifest', originalError: chosenErrorDetail || 'HTTP 401' });
      }
      if (chosenResp.status >= 400) {
        const chosenErrText = typeof chosenResp.data === 'string' ? chosenResp.data : JSON.stringify(chosenResp.data);
        throw new Error(`Registry request failed (HTTP ${chosenResp.status}): ${chosenErrText.slice(0, 200)}`);
      }
      // For manifest list: manifestDigest is platform-specific, indexDigest is the manifest list digest
      // Compute digest from raw bytes if header missing
      const rawChosenManifest: string = chosenResp.data;
      let chosenManifestDigest = chosenResp.headers?.['docker-content-digest'] || null;
      if (!chosenManifestDigest && rawChosenManifest) {
        chosenManifestDigest = 'sha256:' + crypto.createHash('sha256').update(rawChosenManifest).digest('hex');
      } else if (!chosenManifestDigest) {
        chosenManifestDigest = chosenDigest; // fallback to the digest from the manifest list
      }
      let chosenData: any;
      try {
        chosenData = typeof rawChosenManifest === 'string' ? JSON.parse(rawChosenManifest) : rawChosenManifest;
      } catch (parseErr) {
        throw new Error(`Invalid manifest response (not JSON): ${rawChosenManifest?.slice(0, 200)}`);
      }
      return { manifest: chosenData, manifestDigest: chosenManifestDigest, indexDigest: topLevelDigest };
    }

    // Single-platform image: no index, both digests are the same (this is what Docker shows)
    return { manifest: data, manifestDigest: topLevelDigest, indexDigest: topLevelDigest };
  }

  private async fetchManifestWithRealmHandling(registry: string, repository: string, tag: string, credential?: { username: string; password: string } | undefined): Promise<{ manifest: any; token: string | null; manifestDigest: string | null; indexDigest: string | null }> {

    // First try anonymous/credential-free token flow via downloadManifest
    let lastError: any = null;
    try {
      const anon = await this.downloadManifest(registry, repository, tag, null);
      return { manifest: anon.manifest, token: this.lastTokenUsed || null, manifestDigest: anon.manifestDigest, indexDigest: anon.indexDigest };
    } catch (err: any) {
      lastError = err;
      // Check if this is a network-level error (DNS, connection, SSL, proxy) - re-throw these directly
      const errMsg = err?.message || '';
      const errCode = err?.code || '';
      const isNetworkError = errMsg.includes('ENOTFOUND') || 
                             errMsg.includes('ECONNREFUSED') || 
                             errMsg.includes('ETIMEDOUT') ||
                             errMsg.includes('ENETUNREACH') ||
                             errMsg.includes('EAI_AGAIN') ||
                             errMsg.includes('ECONNRESET') ||
                             errMsg.includes('EPIPE') ||
                             errMsg.includes('EHOSTUNREACH') ||
                             errCode === 'SSL_ERROR' ||
                             errMsg.includes('self-signed') ||
                             errMsg.includes('certificate') ||
                             errMsg.includes('UNABLE_TO_VERIFY') ||
                             errMsg.includes('proxy') ||
                             errMsg.includes('Proxy') ||
                             errMsg.includes('PROXY');
      
      if (isNetworkError) {
        // Re-throw network errors with clear message
        const networkError = new Error(`Network error connecting to ${registry}: ${errMsg}`);
        (networkError as any).code = errCode || 'NETWORK_ERROR';
        (networkError as any).originalError = errMsg;
        throw networkError;
      }
      
      // If we have credentials, attempt to obtain token from realm and retry
      if (credential) {
        // First, try to get auth info from /v2/ endpoint (like Docker CLI does)
        // This is more reliable through proxies than trying the manifest endpoint
        logger.debug('Attempting credential auth flow', { registry, repository });
        
        let realm: string | null = null;
        let service: string | null = null;
        
        // Try getting auth info from /v2/ endpoint first
        const authInfo = await this.getRegistryAuthInfo(registry);
        if (authInfo) {
          realm = authInfo.realm;
          service = authInfo.service;
          logger.debug('Got auth info from /v2/ endpoint', { realm, service });
        }
        
        // If /v2/ didn't give us auth info, try the manifest endpoint
        if (!realm) {
          try {
            const protocol = this.getProtocol(registry);
            const url = `${protocol}://${registry}/v2/${repository}/manifests/${tag}`;
            const resp = await this.loggedGet(url, { validateStatus: () => true });
            const www = resp.headers?.['www-authenticate'] || resp.headers?.['WWW-Authenticate'];
            if (www && typeof www === 'string') {
              const realmMatch = www.match(/realm="([^"]+)"/i) || www.match(/realm=([^,\s]+)/i);
              const serviceMatch = www.match(/,\s*service="([^"]+)"/i) || www.match(/,\s*service=([^,\s"]+)/i);
              realm = realmMatch ? realmMatch[1] : null;
              service = serviceMatch ? serviceMatch[1] : (registry === 'registry-1.docker.io' ? 'registry.docker.io' : registry);
              logger.debug('Got auth info from manifest endpoint', { realm, service, www: www.slice(0, 200) });
            }
          } catch (manifestErr: any) {
            logger.debug('Manifest endpoint auth check failed', { error: manifestErr?.message });
          }
        }
        
        // If we have realm info, try to get a token with credentials
        if (realm) {
          try {
            const token = await this.fetchTokenFromRealmWithCred(realm, service || registry, repository, credential.username, credential.password);
            if (token) {
              logger.debug('Got token from realm with credentials, retrying manifest download');
              const m = await this.downloadManifest(registry, repository, tag, token);
              return { manifest: m.manifest, token, manifestDigest: m.manifestDigest, indexDigest: m.indexDigest };
            } else {
              logger.debug('Token fetch with credentials returned null');
            }
          } catch (tokenErr: any) {
            lastError = tokenErr;
            logger.debug('Token fetch with credentials failed', { error: tokenErr?.message });
            const tokenErrMsg = tokenErr?.message || '';
            if (tokenErrMsg.includes('ENOTFOUND') || tokenErrMsg.includes('ECONNREFUSED') || 
                tokenErrMsg.includes('ETIMEDOUT') || tokenErrMsg.includes('proxy') ||
                tokenErrMsg.includes('certificate') || tokenErrMsg.includes('self-signed')) {
              const networkError = new Error(`Network error connecting to ${registry}: ${tokenErrMsg}`);
              (networkError as any).code = tokenErr?.code || 'NETWORK_ERROR';
              throw networkError;
            }
          }
        } else {
          logger.debug('Could not determine auth realm for registry', { registry });
        }
      }
      // If all attempts failed, rethrow with original error details
      const originalErrMsg = lastError?.message || errMsg || 'Unknown error';
      throw new AuthError(`Registry access failed for ${registry}: ${originalErrMsg}`, { registry, repository, reason: 'manifest', originalError: originalErrMsg });
    }
  }

  /**
   * Download a layer blob with progress and speed tracking
   */
  private async downloadLayer(
    registry: string, 
    repository: string, 
    digest: string, 
    token: string | null, 
    destPath: string,
    onProgress?: (downloaded: number, total: number, speedBps: number) => void
  ): Promise<void> {
    const protocol = this.getProtocol(registry);
    const url = `${protocol}://${registry}/v2/${repository}/blobs/${digest}`;
    const headers: any = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await this.loggedGet(url, {
      headers,
      responseType: 'stream',
      validateStatus: () => true
    });
    if (response.status === 401) {
      throw new AuthError(`Authentication required for ${registry}: Layer download failed (HTTP 401)`, { registry, repository, reason: 'layer', digest, originalError: 'HTTP 401' });
    }
    if (response.status >= 400) {
      throw new Error(`Failed to download layer from ${registry}: HTTP ${response.status}`);
    }

    const writeStream = fs.createWriteStream(destPath);
    
    // Track download progress and speed
    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
    let downloaded = 0;
    let startTime = Date.now();
    let lastProgressTime = startTime;
    let lastDownloaded = 0;
    
    if (onProgress && totalSize > 0) {
      response.data.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const now = Date.now();
        const elapsedSinceLastProgress = now - lastProgressTime;
        
        // Update progress every 500ms to avoid overwhelming
        if (elapsedSinceLastProgress >= 500 || downloaded === totalSize) {
          const bytesInInterval = downloaded - lastDownloaded;
          const speedBps = elapsedSinceLastProgress > 0 
            ? Math.round((bytesInInterval / elapsedSinceLastProgress) * 1000) 
            : 0;
          
          onProgress(downloaded, totalSize, speedBps);
          lastProgressTime = now;
          lastDownloaded = downloaded;
        }
      });
    }
    
    await pipelineAsync(response.data, writeStream);
  }

  /**
   * Download and parse image config
   */
  private async downloadConfig(registry: string, repository: string, digest: string, token: string | null): Promise<any> {
    const protocol = this.getProtocol(registry);
    const url = `${protocol}://${registry}/v2/${repository}/blobs/${digest}`;
    const headers: any = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await this.loggedGet(url, { headers, validateStatus: () => true });
    if (response.status === 401) {
      throw new AuthError(`Authentication required for ${registry}: Config download failed (HTTP 401)`, { registry, repository, reason: 'config', digest, originalError: 'HTTP 401' });
    }
    if (response.status >= 400) {
      throw new Error(`Failed to download config from ${registry}: HTTP ${response.status}`);
    }
    return response.data;
  }

  /**
   * Extract entries from a gzipped tar layer
   */
  private async extractLayerEntries(layerPath: string): Promise<Map<string, TarEntry>> {
    const entries = new Map<string, TarEntry>();

    return new Promise((resolve, reject) => {
      const extract = tarStream.extract();

      extract.on('entry', (header: any, stream, next) => {
        const chunks: Buffer[] = [];

        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const data = Buffer.concat(chunks);
          let entryName = header.name.startsWith('./') ? header.name.slice(2) : header.name;
          
          // Normalize path: remove trailing slashes to avoid duplicates (home/ vs home)
          if (entryName.endsWith('/') && entryName.length > 1) {
            entryName = entryName.slice(0, -1);
          }

          entries.set(entryName, {
            name: entryName,
            type: header.type,
            size: header.size || 0,
            mode: header.mode || 0o644,
            uid: header.uid || 0,
            gid: header.gid || 0,
            mtime: header.mtime || new Date(),
            linkname: header.linkname,
            data
          });

          next();
        });

        stream.resume();
      });

      extract.on('finish', () => resolve(entries));
      extract.on('error', reject);

      const readStream = fs.createReadStream(layerPath);
      readStream.pipe(gunzip()).pipe(extract);
    });
  }

  /**
   * Extract ONLY metadata from a gzipped tar layer - memory efficient
   * Does not store file contents in memory, just metadata for building file tree
   */
  private async extractLayerMetadata(layerPath: string): Promise<Map<string, TarEntryMeta>> {
    const entries = new Map<string, TarEntryMeta>();

    return new Promise((resolve, reject) => {
      const extract = tarStream.extract();

      extract.on('entry', (header: any, stream, next) => {
        // Skip the file data - just drain the stream
        stream.on('data', () => { /* discard data to save memory */ });
        stream.on('end', () => {
          let entryName = header.name.startsWith('./') ? header.name.slice(2) : header.name;
          
          // Normalize path: remove trailing slashes to avoid duplicates (home/ vs home)
          if (entryName.endsWith('/') && entryName.length > 1) {
            entryName = entryName.slice(0, -1);
          }

          entries.set(entryName, {
            name: entryName,
            type: header.type,
            size: header.size || 0,
            mode: header.mode || 0o644,
            uid: header.uid || 0,
            gid: header.gid || 0,
            mtime: header.mtime || new Date(),
            linkname: header.linkname
          });

          next();
        });

        stream.resume();
      });

      extract.on('finish', () => resolve(entries));
      extract.on('error', reject);

      const readStream = fs.createReadStream(layerPath);
      readStream.pipe(gunzip()).pipe(extract);
    });
  }

  /**
   * Merge layer metadata handling whiteout files - memory efficient version
   */
  private mergeLayerMetadata(layers: Map<string, TarEntryMeta>[]): Map<string, TarEntryMeta> {
    const merged = new Map<string, TarEntryMeta>();

    for (const layer of layers) {
      for (const [name, entry] of layer.entries()) {
        // Handle whiteout files (.wh. prefix)
        if (name.includes('.wh.')) {
          const dir = path.dirname(name);
          const filename = path.basename(name);

          if (filename.startsWith('.wh..wh..opq')) {
            // Opaque whiteout - remove all entries in this directory
            const dirPrefix = dir === '.' ? '' : dir + '/';
            for (const key of merged.keys()) {
              if (key.startsWith(dirPrefix) && key !== dir) {
                merged.delete(key);
              }
            }
          } else if (filename.startsWith('.wh.')) {
            // Regular whiteout - remove specific file
            const deletedFile = path.join(dir, filename.slice(4)); // Remove .wh. prefix
            merged.delete(deletedFile);
          }
          continue;
        }

        // Add or overwrite entry
        merged.set(name, entry);
      }
    }

    return merged;
  }

  /**
   * Stream layers directly to a merged tar file on disk - MEMORY EFFICIENT
   * Instead of loading all file contents into memory, this streams data through
   */
  private async streamLayersToTar(
    registry: string, 
    repository: string, 
    layers: Array<{ digest: string; size: number; mediaType: string }>, 
    token: string | null, 
    imageCacheDir: string,
    progressCallback?: (progress: number, status: string, speedBps?: number) => void
  ): Promise<{ tarPath: string; totalSize: number; fileTree: FileNode }> {
    const tarPath = path.join(imageCacheDir, 'filesystem.tar');
    
    // Calculate total bytes to download for speed tracking
    const totalBytesToDownload = layers.reduce((sum, layer) => sum + layer.size, 0);
    let totalBytesDownloaded = 0;
    let currentLayerSpeedBps = 0;
    
    // Phase 1: Download all layers to disk first (streaming)
    const layerPaths: string[] = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const layerPath = path.join(imageCacheDir, `layer-${i}.tar.gz`);
      layerPaths.push(layerPath);
      
      logger.debug('Downloading layer', { layer: i + 1, total: layers.length, digest: layer.digest.slice(0, 20), size: layer.size });
      
      if (!fs.existsSync(layerPath)) {
        // Download with progress tracking
        await this.downloadLayer(
          registry, 
          repository, 
          layer.digest, 
          token, 
          layerPath,
          (downloaded, total, speedBps) => {
            currentLayerSpeedBps = speedBps;
            // Calculate overall progress: 20-60% range for layer downloads
            const layerProgressRatio = downloaded / (total || 1);
            const previousLayersRatio = i / layers.length;
            const currentLayerRatio = (1 / layers.length) * layerProgressRatio;
            const overallProgress = 20 + ((previousLayersRatio + currentLayerRatio) * 40);
            
            if (progressCallback) {
              progressCallback(
                Math.round(overallProgress), 
                `Downloading layer ${i + 1}/${layers.length} (${this.formatBytes(downloaded)}/${this.formatBytes(total)})`,
                speedBps
              );
            }
          }
        );
      } else {
        // Layer already exists, report progress
        const progress = 20 + (((i + 1) / layers.length) * 40);
        if (progressCallback) progressCallback(progress, `Layer ${i + 1}/${layers.length} (cached)`);
      }
    }
    
    // Phase 2: Extract metadata only (memory efficient) to determine final file list
    if (progressCallback) progressCallback(65, 'Building file tree (memory efficient)');
    logger.debug('Extracting layer metadata (memory efficient)');
    
    const layerMetadata: Map<string, TarEntryMeta>[] = [];
    for (let i = 0; i < layerPaths.length; i++) {
      const meta = await this.extractLayerMetadata(layerPaths[i]);
      layerMetadata.push(meta);
    }
    
    // Merge metadata to get final file list
    const mergedMeta = this.mergeLayerMetadata(layerMetadata);
    
    // Build file tree from metadata
    const fileTree = this.buildFileTreeFromMetadata(mergedMeta);
    const totalSize = Array.from(mergedMeta.values()).reduce((sum, e) => sum + e.size, 0);
    
    // Phase 3: Stream layers to final merged tar (one layer at a time)
    if (progressCallback) progressCallback(75, 'Creating merged filesystem');
    logger.debug('Streaming layers to merged tar');
    
    await this.streamMergedTar(layerPaths, mergedMeta, tarPath, progressCallback);
    
    // Phase 4: Keep layer files for container terminal feature (Option A - Dual Storage)
    // The original compressed layer files are stored in a 'layers' subdirectory
    // This allows us to create a proper OCI image for `docker load` / `podman load`
    if (progressCallback) progressCallback(95, 'Finalizing layer storage');
    
    const layersDir = path.join(imageCacheDir, 'layers');
    await fs.promises.mkdir(layersDir, { recursive: true });
    
    for (let i = 0; i < layerPaths.length; i++) {
      const srcPath = layerPaths[i];
      const destPath = path.join(layersDir, `layer-${i}.tar.gz`);
      try {
        // Move layer file to layers directory instead of deleting
        await fs.promises.rename(srcPath, destPath);
        logger.debug('Stored layer for container terminal', { layer: i, destPath });
      } catch (err) {
        // If rename fails (cross-device), try copy+delete
        try {
          await fs.promises.copyFile(srcPath, destPath);
          await fs.promises.unlink(srcPath);
        } catch {
          // Ignore errors - layer will be re-downloaded if needed
          logger.debug('Failed to preserve layer file', { layer: i, error: (err as Error).message });
        }
      }
    }
    
    return { tarPath, totalSize, fileTree };
  }

  /**
   * Stream merged tar from layers - processes one layer at a time to minimize memory
   */
  private async streamMergedTar(
    layerPaths: string[], 
    finalEntries: Map<string, TarEntryMeta>, 
    tarPath: string,
    progressCallback?: (progress: number, status: string) => void
  ): Promise<void> {
    // Track which entries have been written (by newest layer first)
    const writtenEntries = new Set<string>();
    
    // Create the output tar stream
    const pack = tarStream.pack();
    const writeStream = fs.createWriteStream(tarPath);
    pack.pipe(writeStream);
    
    logger.debug('streamMergedTar: Starting', { layerCount: layerPaths.length, finalEntriesCount: finalEntries.size });
    
    // Process layers in reverse order (newest first) to handle overwrites correctly
    // For each file, only write from the layer where it appears last (newest)
    
    // Build a map of which layer each final file comes from
    logger.debug('streamMergedTar: Building file-to-layer index');
    const fileToLayerIndex = new Map<string, number>();
    for (let i = 0; i < layerPaths.length; i++) {
      logger.debug('streamMergedTar: Extracting metadata for layer', { layer: i + 1, path: layerPaths[i] });
      const meta = await this.extractLayerMetadata(layerPaths[i]);
      logger.debug('streamMergedTar: Layer metadata extracted', { layer: i + 1, entries: meta.size });
      for (const [name] of meta.entries()) {
        if (!name.includes('.wh.') && finalEntries.has(name)) {
          fileToLayerIndex.set(name, i); // Last layer wins
        }
      }
    }
    
    logger.debug('streamMergedTar: File-to-layer index built', { totalFiles: fileToLayerIndex.size });
    
    // Group files by their source layer
    const layerFiles = new Map<number, Set<string>>();
    for (const [name, layerIdx] of fileToLayerIndex.entries()) {
      if (!layerFiles.has(layerIdx)) {
        layerFiles.set(layerIdx, new Set());
      }
      layerFiles.get(layerIdx)!.add(name);
    }
    
    logger.debug('streamMergedTar: Files grouped by layer', { 
      layersWithFiles: layerFiles.size,
      filesPerLayer: Array.from(layerFiles.entries()).map(([idx, files]) => ({ layer: idx, count: files.size }))
    });
    
    // Process each layer and extract only the files that come from that layer
    for (let i = 0; i < layerPaths.length; i++) {
      const filesFromThisLayer = layerFiles.get(i);
      if (!filesFromThisLayer || filesFromThisLayer.size === 0) {
        logger.debug('streamMergedTar: Skipping layer (no files)', { layer: i + 1 });
        continue;
      }
      
      const progress = 75 + ((i / layerPaths.length) * 15);
      if (progressCallback) progressCallback(progress, `Processing layer ${i + 1}/${layerPaths.length}`);
      
      logger.debug('streamMergedTar: Calling extractAndWriteFiles', { layer: i + 1, filesToExtract: filesFromThisLayer.size });
      await this.extractAndWriteFiles(layerPaths[i], filesFromThisLayer, pack, writtenEntries);
      logger.debug('streamMergedTar: Layer processed', { layer: i + 1, totalWritten: writtenEntries.size });
    }
    
    logger.debug('streamMergedTar: All layers processed, finalizing tar');
    
    // Finalize the tar
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        logger.debug('streamMergedTar: Tar file write complete');
        resolve();
      });
      writeStream.on('error', (err) => {
        logger.error('streamMergedTar: Write stream error', { error: err.message });
        reject(err);
      });
      pack.finalize();
    });
  }

  /**
   * Extract specific files from a layer and write them to the tar pack
   */
  private async extractAndWriteFiles(
    layerPath: string, 
    filesToExtract: Set<string>, 
    pack: tarStream.Pack,
    writtenEntries: Set<string>
  ): Promise<void> {
    logger.debug('extractAndWriteFiles: Starting', { layerPath, filesToExtract: filesToExtract.size });
    let entriesProcessed = 0;
    let entriesWritten = 0;
    
    return new Promise((resolve, reject) => {
      const extract = tarStream.extract();

      extract.on('entry', (header: any, stream, next) => {
        let entryName = header.name.startsWith('./') ? header.name.slice(2) : header.name;
        
        // Normalize path: remove trailing slashes to match the normalized filesToExtract set
        if (entryName.endsWith('/') && entryName.length > 1) {
          entryName = entryName.slice(0, -1);
        }
        
        entriesProcessed++;
        
        // Check if we should extract this file
        if (filesToExtract.has(entryName) && !writtenEntries.has(entryName)) {
          writtenEntries.add(entryName);
          entriesWritten++;
          
          // Create header for the output tar
          const outHeader: any = {
            name: entryName,
            size: header.size,
            mode: header.mode,
            uid: header.uid,
            gid: header.gid,
            mtime: header.mtime,
            type: header.type // Preserve original type (file, directory, symlink, link, etc.)
          };
          
          if (header.linkname) {
            outHeader.linkname = header.linkname;
          }
          
          // Collect data for files with content, then write to pack
          if (header.type === 'file' && header.size > 0) {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              const data = Buffer.concat(chunks);
              pack.entry(outHeader, data, (err) => {
                if (err) {
                  logger.error('extractAndWriteFiles: Error writing entry', { entryName, error: err.message });
                }
                next();
              });
            });
            stream.on('error', (err) => {
              logger.error('extractAndWriteFiles: Stream error', { entryName, error: err.message });
              next();
            });
          } else if (header.type === 'file') {
            // Zero-byte file - write empty buffer and drain stream
            stream.on('end', () => {
              pack.entry(outHeader, Buffer.alloc(0), (err) => {
                if (err) {
                  logger.error('extractAndWriteFiles: Error writing empty file', { entryName, error: err.message });
                }
                next();
              });
            });
            stream.resume();
          } else {
            // For directories, symlinks, hard links - no content to write
            // For symlinks/links, the linkname is in the header
            pack.entry(outHeader, undefined, (err) => {
              if (err) {
                logger.error('extractAndWriteFiles: Error writing non-file entry', { entryName, error: err.message });
              }
              next();
            });
            stream.resume();
          }
        } else {
          // Skip this entry
          stream.resume();
          stream.on('end', next);
        }
      });

      extract.on('finish', () => {
        logger.debug('extractAndWriteFiles: Complete', { entriesProcessed, entriesWritten });
        resolve();
      });
      
      extract.on('error', (err) => {
        logger.error('extractAndWriteFiles: Extract error', { error: err.message });
        reject(err);
      });

      const readStream = fs.createReadStream(layerPath);
      readStream.on('error', (err) => {
        logger.error('extractAndWriteFiles: Read stream error', { error: err.message });
        reject(err);
      });
      
      readStream.pipe(gunzip()).pipe(extract);
    });
  }

  /**
   * Build file tree from metadata entries (no file content needed)
   */
  private buildFileTreeFromMetadata(entries: Map<string, TarEntryMeta>): FileNode {
    const root: FileNode = {
      name: '/',
      path: '/',
      type: 'directory',
      size: 0,
      children: []
    };

    const nodeMap = new Map<string, FileNode>();
    nodeMap.set('/', root);

    // Sort entries by path depth
    const sortedEntries = Array.from(entries.entries()).sort((a, b) => {
      const aDepth = a[0].split('/').length;
      const bDepth = b[0].split('/').length;
      return aDepth - bDepth;
    });

    for (const [entryPath, entry] of sortedEntries) {
      if (!entryPath || entryPath === '/') continue;

      const normalizedPath = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
      const parts = normalizedPath.split('/').filter(p => p);
      const name = parts[parts.length - 1] || '/';

      const node: FileNode = {
        name,
        path: normalizedPath,
        type: entry.type === 'directory' ? 'directory' : entry.type === 'symlink' ? 'symlink' : 'file',
        size: entry.size,
        mode: entry.mode ? `0${(entry.mode & 0o777).toString(8)}` : undefined,
        uid: entry.uid,
        gid: entry.gid,
        mtime: entry.mtime,
        linkname: entry.linkname
      };

      if (node.type === 'directory') {
        node.children = [];
      }

      nodeMap.set(normalizedPath, node);

      // Find or create parent
      const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/';
      let parent = nodeMap.get(parentPath);

      if (!parent) {
        // Create missing parent directories
        const parentParts = parentPath.split('/').filter(p => p);
        let currentPath = '/';
        parent = root;

        for (const part of parentParts) {
          currentPath = currentPath === '/' ? `/${part}` : `${currentPath}/${part}`;
          let dir = nodeMap.get(currentPath);

          if (!dir) {
            dir = {
              name: part,
              path: currentPath,
              type: 'directory',
              size: 0,
              children: []
            };
            nodeMap.set(currentPath, dir);
            parent.children!.push(dir);
          }

          parent = dir;
        }
      }

      parent.children!.push(node);
    }

    return root;
  }

  /**
   * Merge layers handling whiteout files
   */
  private mergeLayers(layers: Map<string, TarEntry>[]): Map<string, TarEntry> {
    const merged = new Map<string, TarEntry>();

    for (const layer of layers) {
      for (const [name, entry] of layer.entries()) {
        // Handle whiteout files (.wh. prefix)
        if (name.includes('.wh.')) {
          const dir = path.dirname(name);
          const filename = path.basename(name);

          if (filename.startsWith('.wh..wh..opq')) {
            // Opaque whiteout - remove all entries in this directory
            const dirPrefix = dir === '.' ? '' : dir + '/';
            for (const key of merged.keys()) {
              if (key.startsWith(dirPrefix) && key !== dir) {
                merged.delete(key);
              }
            }
          } else if (filename.startsWith('.wh.')) {
            // Regular whiteout - remove specific file
            const deletedFile = path.join(dir, filename.slice(4)); // Remove .wh. prefix
            merged.delete(deletedFile);
          }
          continue;
        }

        // Add or overwrite entry
        merged.set(name, entry);
      }
    }

    return merged;
  }

  /**
   * Write merged entries to a tar file
   */
  private async writeMergedTar(entries: Map<string, TarEntry>, tarPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pack = tarStream.pack();
      const writeStream = fs.createWriteStream(tarPath);

      pack.pipe(writeStream);

      writeStream.on('finish', resolve);
      writeStream.on('error', reject);

      // Sort entries to ensure directories come before files
      const sortedEntries = Array.from(entries.entries()).sort((a, b) => {
        const aDepth = a[0].split('/').length;
        const bDepth = b[0].split('/').length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a[0].localeCompare(b[0]);
      });

      for (const [name, entry] of sortedEntries) {
        const header: any = {
          name: entry.name,
          size: entry.size,
          mode: entry.mode,
          uid: entry.uid,
          gid: entry.gid,
          mtime: entry.mtime,
          type: entry.type === 'symlink' ? 'symlink' : entry.type === 'directory' ? 'directory' : 'file'
        };

        if (entry.linkname) {
          header.linkname = entry.linkname;
        }

        pack.entry(header, entry.data);
      }

      pack.finalize();
    });
  }

  /**
   * Build file tree from tar entries
   */
  private buildFileTreeFromEntries(entries: Map<string, TarEntry>): FileNode {
    const root: FileNode = {
      name: '/',
      path: '/',
      type: 'directory',
      size: 0,
      children: []
    };

    const nodeMap = new Map<string, FileNode>();
    nodeMap.set('/', root);

    // Sort entries by path depth
    const sortedEntries = Array.from(entries.entries()).sort((a, b) => {
      const aDepth = a[0].split('/').length;
      const bDepth = b[0].split('/').length;
      return aDepth - bDepth;
    });

    for (const [entryPath, entry] of sortedEntries) {
      if (!entryPath || entryPath === '/') continue;

      const normalizedPath = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
      const parts = normalizedPath.split('/').filter(p => p);
      const name = parts[parts.length - 1] || '/';

      const node: FileNode = {
        name,
        path: normalizedPath,
        type: entry.type === 'directory' ? 'directory' : entry.type === 'symlink' ? 'symlink' : 'file',
        size: entry.size,
        mode: entry.mode ? `0${(entry.mode & 0o777).toString(8)}` : undefined,
        uid: entry.uid,
        gid: entry.gid,
        mtime: entry.mtime,
        linkname: entry.linkname
      };

      if (node.type === 'directory') {
        node.children = [];
      }

      nodeMap.set(normalizedPath, node);

      // Find or create parent
      const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/';
      let parent = nodeMap.get(parentPath);

      if (!parent) {
        // Create missing parent directories
        const parentParts = parentPath.split('/').filter(p => p);
        let currentPath = '/';
        parent = root;

        for (const part of parentParts) {
          currentPath = currentPath === '/' ? `/${part}` : `${currentPath}/${part}`;
          let dir = nodeMap.get(currentPath);

          if (!dir) {
            dir = {
              name: part,
              path: currentPath,
              type: 'directory',
              size: 0,
              children: []
            };
            nodeMap.set(currentPath, dir);
            parent.children!.push(dir);
          }

          parent = dir;
        }
      }

      parent.children!.push(node);
    }

    return root;
  }

  /**
   * Get cached image data if it exists
   */
  async getCachedImage(imageRef: string): Promise<CachedImageData | null> {
    // Check memory cache first by exact imageRef
    if (this.imageCache.has(imageRef)) {
      const cached = this.imageCache.get(imageRef)!;
      // Verify tar file still exists
      if (fs.existsSync(cached.tarPath)) {
        return cached;
      }
    }

    // Check disk cache - scan all cache directories for refs.json that includes this imageRef
    try {
      const cacheDirs = await fs.promises.readdir(this.cacheDir);
      for (const dir of cacheDirs) {
        const imageCacheDir = path.join(this.cacheDir, dir);
        const tarPath = path.join(imageCacheDir, 'filesystem.tar');
        const configPath = path.join(imageCacheDir, 'config.json');
        const refsPath = path.join(imageCacheDir, 'refs.json');

        if (!fs.existsSync(tarPath) || !fs.existsSync(configPath)) continue;
        
        // Check if this cache dir contains our imageRef
        let refs: string[] = [];
        try {
          if (fs.existsSync(refsPath)) {
            refs = JSON.parse(await fs.promises.readFile(refsPath, 'utf-8'));
          }
        } catch {
          // refs.json doesn't exist or is invalid
        }
        
        // If refs.json exists and contains our imageRef, load from this cache
        if (refs.includes(imageRef)) {
          logger.debug('Loading from disk cache via refs.json', { imageRef, cacheDir: dir });
          // Use memory-efficient metadata extraction instead of loading all file contents
          const entries = await this.extractLayerMetadata(tarPath);
          const fileTree = this.buildFileTreeFromMetadata(entries);
          const totalSize = Array.from(entries.values()).reduce((sum, e) => sum + e.size, 0);
          const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
          const { registry, repository, tag } = this.parseImageRef(imageRef);

          // Load saved digests from disk
          const savedDigests = await this.loadDigests(imageCacheDir);
          const digest = savedDigests.digest || (config?.rootfs?.diff_ids ? config.rootfs.diff_ids[config.rootfs.diff_ids.length - 1] : undefined);

          const cached: CachedImageData = {
            imageRef: { registry, repository, tag, fullName: imageRef },
            config,
            filesystem: fileTree,
            cachedAt: new Date().toISOString(),
            sizeBytes: totalSize,
            tarPath,
            digest,
            manifestDigest: savedDigests.manifestDigest,
            indexDigest: savedDigests.indexDigest
          };
          this.imageCache.set(imageRef, cached);
          return cached;
        }
      }
    } catch (err) {
      logger.debug('Error scanning cache directories', { error: (err as Error).message });
    }

    return null;
  }

  /**
   * Verify a cached image by comparing its canonical config digest with the registry's current manifest config digest.
   * Returns true if up-to-date, false if the remote has a different digest (cache stale).
   */
  async verifyCachedImage(cached: CachedImageData): Promise<boolean> {
    try {
      const { registry, repository, tag } = cached.imageRef;
      const protocol = this.getProtocol(registry);
      // Fetch manifest (no token here — caller may handle auth)
      const url = `${protocol}://${registry}/v2/${repository}/manifests/${tag}`;
      const resp = await this.loggedGet(url, { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' }, validateStatus: () => true });
      if (!resp || resp.status !== 200) return false;
      const manifest = resp.data as any;
      const remoteConfigDigest = manifest?.config?.digest;
      if (!remoteConfigDigest || !cached.digest) return false;
      return remoteConfigDigest === cached.digest;
    } catch (err) {
      logger.debug('verifyCachedImage failed', { error: (err as any)?.message });
      return false;
    }
  }

  /**
   * Fetch manifest and extract config digest from registry.
   * This ALWAYS makes a network request to get the current digest.
   * Returns the config digest which uniquely identifies the image content,
   * the manifest digest (platform-specific), the index digest (manifest list digest, what Docker shows),
   * and the compressed size (sum of all layer sizes, what "docker images" shows).
   */
  async getRemoteImageDigest(imageRef: string, credential?: { username: string; password: string }): Promise<{ configDigest: string; manifestDigest: string | null; indexDigest: string | null; compressedSizeBytes: number; manifest: any; token: string | null } | null> {
    const { registry, repository, tag } = this.parseImageRef(imageRef);
    
    try {
      const manifestResult = await this.fetchManifestWithRealmHandling(registry, repository, tag, credential);
      let manifest = manifestResult.manifest;
      let manifestDigest = manifestResult.manifestDigest;
      let indexDigest = manifestResult.indexDigest; // This is the manifest list digest (what Docker shows)
      
      // If it's a manifest list, resolve to concrete manifest
      if (manifest && manifest.manifests && Array.isArray(manifest.manifests)) {
        let chosen = manifest.manifests.find((m: any) => m.platform && m.platform.os === 'linux' && (m.platform.architecture === 'amd64' || m.platform.architecture === 'x86_64'));
        if (!chosen) chosen = manifest.manifests.find((m: any) => m.platform && m.platform.os === 'linux');
        if (!chosen) chosen = manifest.manifests[0];
        
        const resolvedManifest = await this.downloadManifest(registry, repository, chosen.digest, manifestResult.token);
        manifest = resolvedManifest.manifest;
        // Use the manifest digest from the resolved manifest (platform-specific)
        manifestDigest = resolvedManifest.manifestDigest;
        // indexDigest should already be set from fetchManifestWithRealmHandling
      }
      
      const configDigest = manifest?.config?.digest;
      if (!configDigest) {
        logger.warn('No config digest found in manifest', { imageRef });
        return null;
      }
      
      // Calculate compressed size (sum of all layer sizes) - this is what "docker images" shows
      let compressedSizeBytes = manifest?.config?.size || 0;
      if (manifest?.layers && Array.isArray(manifest.layers)) {
        compressedSizeBytes += manifest.layers.reduce((sum: number, layer: any) => sum + (layer.size || 0), 0);
      }
      
      return { configDigest, manifestDigest, indexDigest, compressedSizeBytes, manifest, token: manifestResult.token };
    } catch (err) {
      logger.debug('Failed to get remote image digest', { imageRef, error: (err as any)?.message });
      throw err;
    }
  }

  /**
   * Download image and create merged tar file.
   * ALWAYS fetches manifest from registry first to get current digest,
   * then checks cache by digest before downloading layers.
   */
  async downloadAndCacheImage(imageRef: string, credential?: { id: string; registry: string; username: string; password: string }, progressCallback?: (progress: number, status: string, speedBps?: number) => void): Promise<CachedImageData> {
    const { registry, repository, tag } = this.parseImageRef(imageRef);
    
    // Track that this image is being downloaded
    this.downloadsInProgress.add(imageRef);
    
    try {
    // Step 1: ALWAYS fetch manifest to get current digest
    if (progressCallback) progressCallback(5, 'Fetching manifest digest');
    logger.info('Fetching remote manifest digest', { imageRef });
    
    const remoteInfo = await this.getRemoteImageDigest(
      imageRef,
      credential ? { username: credential.username, password: credential.password } : undefined
    );
    
    if (!remoteInfo) {
      throw new Error(`Failed to get manifest for ${imageRef}`);
    }
    
    const { configDigest, manifestDigest, indexDigest, compressedSizeBytes, manifest: finalManifest, token: tokenForBlobs } = remoteInfo;
    logger.info('Got remote digests', { 
      imageRef, 
      configDigest: configDigest.slice(0, 20), 
      manifestDigest: manifestDigest || 'NULL',
      indexDigest: indexDigest || 'NULL',
      compressedSizeBytes
    });
    
    // Step 2: Check if we already have this digest cached (from ANY image ref)
    const existingByDigest = this.getCachedImageByDigest(configDigest);
    if (existingByDigest && fs.existsSync(existingByDigest.tarPath)) {
      logger.info('Found existing cache by digest', { imageRef, cachedAs: existingByDigest.imageRef.fullName });
      // Create a new CachedImageData with the requested imageRef (not the original cached one)
      // This ensures the UI shows the correct image name
      const cachedWithRequestedRef: CachedImageData = {
        ...existingByDigest,
        imageRef: { registry, repository, tag, fullName: imageRef },
        manifestDigest: manifestDigest || existingByDigest.manifestDigest, // Update manifest digest if available
        indexDigest: indexDigest || existingByDigest.indexDigest, // Update index digest (what Docker shows)
        compressedSizeBytes: compressedSizeBytes || existingByDigest.compressedSizeBytes // Combined compressed layer sizes
      };
      // Store under current imageRef for faster future lookups
      this.imageCache.set(imageRef, cachedWithRequestedRef);
      // Update refs.json to track this imageRef
      await this.updateCacheRefs(path.dirname(existingByDigest.tarPath), imageRef);
      if (progressCallback) progressCallback(100, 'Complete (from cache)');
      return cachedWithRequestedRef;
    }
    
    // Step 3: Check memory cache by image ref
    if (this.imageCache.has(imageRef)) {
      const cached = this.imageCache.get(imageRef)!;
      if (fs.existsSync(cached.tarPath) && cached.digest === configDigest) {
        logger.info('Using memory cached image', { imageRef });
        if (progressCallback) progressCallback(100, 'Complete (from cache)');
        return { ...cached, manifestDigest: manifestDigest || cached.manifestDigest, indexDigest: indexDigest || cached.indexDigest, compressedSizeBytes: compressedSizeBytes || cached.compressedSizeBytes };
      }
    }

    // Step 3.5: Auto-enforce cache limit before downloading new image
    // This keeps cache within max size automatically without manual intervention
    try {
      const settings = settingsService.getSettings();
      const maxSizeGB = settings.maxCacheSizeGB || 20;
      const stats = await this.getCacheStats();
      
      if (stats.combinedSizeGB > maxSizeGB) {
        logger.info('Cache exceeds limit, auto-enforcing', {
          cacheGB: stats.totalSizeGB.toFixed(2),
          podmanGB: stats.podmanSizeGB.toFixed(2),
          combinedGB: stats.combinedSizeGB.toFixed(2),
          maxGB: maxSizeGB
        });
        const result = await this.enforceCacheLimit(maxSizeGB);
        if (result.removedCount > 0) {
          logger.info('Auto-cleanup completed', { 
            removedCount: result.removedCount, 
            freedGB: (result.freedBytes / 1024 / 1024 / 1024).toFixed(2) 
          });
        }
      }
    } catch (err) {
      // Don't fail the download if cache enforcement fails
      logger.warn('Failed to auto-enforce cache limit', { error: (err as Error).message });
    }

    // Step 4: Create cache directory for this image (keyed by digest for deduplication)
    const imageHash = crypto.createHash('sha256').update(configDigest).digest('hex').slice(0, 16);
    const imageCacheDir = path.join(this.cacheDir, imageHash);
    await fs.promises.mkdir(imageCacheDir, { recursive: true });

    const tarPath = path.join(imageCacheDir, 'filesystem.tar');
    const configPath = path.join(imageCacheDir, 'config.json');

    // Step 5: Check if tar already exists on disk (by digest-based path)
    if (fs.existsSync(tarPath) && fs.existsSync(configPath)) {
      logger.info('Using existing tar file from disk', { imageRef, cacheDir: imageCacheDir });
      if (progressCallback) progressCallback(90, 'Loading from disk cache');
      // Use memory-efficient metadata extraction instead of loading all file contents
      const entries = await this.extractLayerMetadata(tarPath);
      const fileTree = this.buildFileTreeFromMetadata(entries);
      const totalSize = Array.from(entries.values()).reduce((sum, e) => sum + e.size, 0);
      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      const diskDigests = await this.loadDigests(imageCacheDir);

      const cached: CachedImageData = {
        imageRef: { registry, repository, tag, fullName: imageRef },
        config,
        filesystem: fileTree,
        cachedAt: new Date().toISOString(),
        sizeBytes: totalSize,
        tarPath,
        digest: configDigest,
        manifestDigest: manifestDigest || undefined,
        indexDigest: indexDigest || undefined,
        compressedSizeBytes: compressedSizeBytes || diskDigests?.compressedSizeBytes
      };

      this.imageCache.set(imageRef, cached);
      // Update refs.json to track this imageRef
      await this.updateCacheRefs(imageCacheDir, imageRef);
      // Save/update digests to disk (we may have fresh manifest digests from registry)
      await this.saveDigests(imageCacheDir, { digest: configDigest, manifestDigest: manifestDigest || undefined, indexDigest: indexDigest || undefined, compressedSizeBytes: compressedSizeBytes || diskDigests?.compressedSizeBytes });
      if (progressCallback) progressCallback(100, 'Complete');
      return cached;
    }

    // Step 6: Download config and layers - clean up cache dir on failure
    let downloadSucceeded = false;
    try {
    logger.info('Downloading image layers (memory-efficient streaming)', { imageRef });
    if (progressCallback) progressCallback(15, 'Downloading config');
    logger.debug('Downloading config', { configDigest: finalManifest.config.digest });
    const config = await this.downloadConfig(registry, repository, finalManifest.config.digest, tokenForBlobs);
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));

    // Step 7: Use memory-efficient streaming to download and merge layers
    logger.info('Streaming layers to disk (memory-efficient)', { count: finalManifest.layers.length });

    const { totalSize, fileTree } = await this.streamLayersToTar(
      registry,
      repository,
      finalManifest.layers,
      tokenForBlobs,
      imageCacheDir,
      progressCallback
    );

    const cached: CachedImageData = {
      imageRef: { registry, repository, tag, fullName: imageRef },
      config,
      filesystem: fileTree,
      cachedAt: new Date().toISOString(),
      sizeBytes: totalSize,
      tarPath,
      digest: configDigest,
      manifestDigest: manifestDigest || undefined,
      indexDigest: indexDigest || undefined,
      compressedSizeBytes
    };

    this.imageCache.set(imageRef, cached);
    // Update refs.json to track this imageRef
    await this.updateCacheRefs(imageCacheDir, imageRef);
    // Save digests to disk for later retrieval
    await this.saveDigests(imageCacheDir, { digest: configDigest, manifestDigest: manifestDigest || undefined, indexDigest: indexDigest || undefined, compressedSizeBytes });

    if (progressCallback) progressCallback(100, 'Complete');
    logger.info('Image cached successfully', { imageRef });
    downloadSucceeded = true;

    // Trigger background preparation for container terminal (non-blocking)
    // This creates docker-image.tar, loads into podman, then cleans up tar/layers
    const self = this;
    setImmediate(() => {
      containerTerminalService.prepareImageForTerminal(
        imageRef,
        imageCacheDir,
        () => self.getDockerImageTarPath(imageRef)
      ).catch(err => {
        logger.debug('Background image preparation failed (non-critical)', { imageRef, error: err.message });
      });
    });

    return cached;
    } catch (downloadErr) {
      // Clean up partial/orphaned cache directory on download failure
      if (!downloadSucceeded) {
        try {
          logger.info('Cleaning up failed download cache directory', { imageRef, imageCacheDir });
          await this.deleteDirRecursive(imageCacheDir);
        } catch (cleanupErr) {
          logger.warn('Failed to clean up partial cache directory', { imageCacheDir, error: (cleanupErr as Error).message });
        }
      }
      throw downloadErr;
    }
    } finally {
      // Always remove from in-progress set when done (success or failure)
      this.downloadsInProgress.delete(imageRef);
    }
  }

  /**
   * Get file content from cached tar file.
   * This method only uses local cache and does NOT make network requests.
   * Throws an error if the image is not cached.
   */
  async getFileContentFromTar(imageRef: string, filePath: string): Promise<Buffer> {
    // Try memory cache first (fast, no disk I/O)
    let cached: CachedImageData | null | undefined = this.getCachedImageFromMemory(imageRef);
    
    // If not in memory, try disk cache (async, no network)
    if (!cached) {
      cached = await this.getCachedImage(imageRef);
    }
    
    if (!cached) {
      throw new Error(`Image not found in cache: ${imageRef}. The image must be compared first.`);
    }
    const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    return new Promise((resolve, reject) => {
      const extract = tarStream.extract();
      let found = false;

      extract.on('entry', (header: any, stream, next) => {
        const entryName = header.name.startsWith('./') ? header.name.slice(2) : header.name;

        if (entryName === normalizedPath) {
          found = true;
          const chunks: Buffer[] = [];

          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            resolve(Buffer.concat(chunks));
          });
        } else {
          stream.resume();
        }

        stream.on('end', next);
      });

      extract.on('finish', () => {
        if (!found) {
          reject(new Error(`File not found in tar: ${filePath}`));
        }
      });

      extract.on('error', reject);

      fs.createReadStream(cached.tarPath).pipe(extract);
    });
  }

  /**
   * Get file content (alias for getFileContentFromTar)
   */
  async getFileContent(imageRef: string, filePath: string): Promise<Buffer> {
    return this.getFileContentFromTar(imageRef, filePath);
  }

  /**
   * Get path to cached tar file
   */
  async getTarPath(imageRef: string): Promise<string> {
    const cached = await this.downloadAndCacheImage(imageRef);
    return cached.tarPath;
  }

  /**
   * Get file tree for an image
   */
  async getFileTree(imageRef: string): Promise<FileNode> {
    const cached = await this.downloadAndCacheImage(imageRef);
    return cached.filesystem;
  }

  /**
   * Create a Docker-compatible image tar for use with `docker load` / `podman load`
   * 
   * ============================================================================
   * CONTAINER RUNTIME INTEGRATION (Terminal Feature Only)
   * ============================================================================
   * This method creates a proper OCI/Docker image archive that can be loaded
   * into Docker or Podman using `docker load -i` or `podman load -i`.
   * 
   * This is used ONLY by the interactive terminal feature to run containers
   * from cached images. No other feature in this application requires this.
   * 
   * The created archive follows the Docker image format:
   * - Each layer as a separate .tar file
   * - A config JSON file
   * - A manifest.json describing the image
   * 
   * NOTE: Uses streaming to handle layers larger than 2GB.
   * ============================================================================
   */
  async createDockerImageTar(imageRef: string): Promise<string> {
    const cached = await this.getCachedImage(imageRef);
    if (!cached) {
      throw new Error(`Image not cached: ${imageRef}`);
    }

    const imageCacheDir = path.dirname(cached.tarPath);
    const dockerImagePath = path.join(imageCacheDir, 'docker-image.tar');

    // Check if we already have a docker-image.tar
    if (fs.existsSync(dockerImagePath)) {
      logger.debug('Docker image tar already exists', { imageRef, path: dockerImagePath });
      return dockerImagePath;
    }

    // Check if we have the original layers
    const layersDir = path.join(imageCacheDir, 'layers');
    if (!fs.existsSync(layersDir)) {
      throw new Error(`Original layers not available for ${imageRef}. Image may need to be re-downloaded.`);
    }

    const layerFiles = await fs.promises.readdir(layersDir);
    const layerTarGzFiles = layerFiles.filter(f => f.endsWith('.tar.gz')).sort();

    if (layerTarGzFiles.length === 0) {
      throw new Error(`No layer files found for ${imageRef}`);
    }

    logger.info('Creating Docker-compatible image tar', { imageRef, layerCount: layerTarGzFiles.length });

    // Create the docker image tar archive
    const pack = tarStream.pack();
    const writeStream = fs.createWriteStream(dockerImagePath);
    pack.pipe(writeStream);

    // Helper to write small entries (metadata files)
    const writeEntry = (name: string, data: Buffer | string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const buffer = typeof data === 'string' ? Buffer.from(data) : data;
        pack.entry({ name, size: buffer.length }, buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    // Helper to stream a file into the tar archive (for large layers)
    const streamFileToTar = (entryName: string, filePath: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const stat = fs.statSync(filePath);
        const entry = pack.entry({ name: entryName, size: stat.size }, (err) => {
          if (err) reject(err);
          else resolve();
        });
        
        const readStream = fs.createReadStream(filePath);
        readStream.on('error', reject);
        readStream.pipe(entry);
      });
    };

    // Generate unique IDs for layers based on content hash
    const layerIds: string[] = [];
    const layerDiffIds: string[] = [];
    const zlib = require('zlib');

    // First pass: decompress layers to temp files and calculate hashes
    const tempLayerPaths: string[] = [];
    
    for (let i = 0; i < layerTarGzFiles.length; i++) {
      const layerGzPath = path.join(layersDir, layerTarGzFiles[i]);
      const tempLayerPath = path.join(imageCacheDir, `temp-layer-${i}.tar`);
      tempLayerPaths.push(tempLayerPath);
      
      // Generate layer ID from compressed content
      const compressedData = await fs.promises.readFile(layerGzPath);
      const layerHash = crypto.createHash('sha256');
      layerHash.update(compressedData);
      const layerId = layerHash.digest('hex');
      layerIds.push(layerId);

      // Decompress to temp file (streaming to avoid memory issues)
      await new Promise<void>((resolve, reject) => {
        const gunzipStream = zlib.createGunzip();
        const readStream = fs.createReadStream(layerGzPath);
        const tempWriteStream = fs.createWriteStream(tempLayerPath);
        
        readStream.pipe(gunzipStream).pipe(tempWriteStream);
        
        tempWriteStream.on('finish', resolve);
        tempWriteStream.on('error', reject);
        gunzipStream.on('error', reject);
        readStream.on('error', reject);
      });

      // Calculate diff_id from decompressed content (streaming hash)
      const diffId = await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(tempLayerPath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve('sha256:' + hash.digest('hex')));
        stream.on('error', reject);
      });
      layerDiffIds.push(diffId);

      logger.debug('Processed layer', { layer: i + 1, total: layerTarGzFiles.length, id: layerId.slice(0, 12) });
    }

    // Second pass: write layers to tar archive
    for (let i = 0; i < layerIds.length; i++) {
      const layerId = layerIds[i];
      const tempLayerPath = tempLayerPaths[i];

      // VERSION file
      await writeEntry(`${layerId}/VERSION`, '1.0');
      
      // layer.tar (streamed from temp file)
      await streamFileToTar(`${layerId}/layer.tar`, tempLayerPath);
      
      // json file for this layer (legacy Docker format)
      const layerJson: any = {
        id: layerId,
        created: cached.config?.created || new Date().toISOString(),
        container_config: {
          Hostname: '',
          Domainname: '',
          User: '',
          AttachStdin: false,
          AttachStdout: false,
          AttachStderr: false,
          Tty: false,
          OpenStdin: false,
          StdinOnce: false,
          Env: null,
          Cmd: null,
          Image: '',
          Volumes: null,
          WorkingDir: '',
          Entrypoint: null,
          OnBuild: null,
          Labels: null
        }
      };
      
      if (i > 0) {
        layerJson.parent = layerIds[i - 1];
      }
      
      await writeEntry(`${layerId}/json`, JSON.stringify(layerJson));

      logger.debug('Added layer to docker image', { layer: i + 1, total: layerTarGzFiles.length, id: layerId.slice(0, 12) });
      
      // Clean up temp file
      await fs.promises.unlink(tempLayerPath);
    }

    // Create the image config (using the original config.json as base)
    const imageConfig: any = {
      ...cached.config,
      rootfs: {
        type: 'layers',
        diff_ids: layerDiffIds
      }
    };
    
    // Ensure required fields exist
    if (!imageConfig.architecture) imageConfig.architecture = 'amd64';
    if (!imageConfig.os) imageConfig.os = 'linux';
    
    // Generate config blob
    const configJson = JSON.stringify(imageConfig);
    const configHash = crypto.createHash('sha256');
    configHash.update(configJson);
    const configDigest = configHash.digest('hex');
    
    // Add config blob
    await writeEntry(`${configDigest}.json`, configJson);

    // Create manifest.json (Docker save format)
    const { repository, tag } = this.parseImageRef(imageRef);
    const repoTag = `${repository}:${tag || 'latest'}`;
    
    const manifest = [{
      Config: `${configDigest}.json`,
      RepoTags: [repoTag],
      Layers: layerIds.map(id => `${id}/layer.tar`)
    }];
    await writeEntry('manifest.json', JSON.stringify(manifest));

    // Create repositories file (legacy format, needed by some tools)
    const repositories: any = {};
    repositories[repository] = {};
    repositories[repository][tag || 'latest'] = layerIds[layerIds.length - 1];
    await writeEntry('repositories', JSON.stringify(repositories));

    // Finalize the tar
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        logger.info('Docker image tar created successfully', { imageRef, path: dockerImagePath, layers: layerIds.length });
        resolve(dockerImagePath);
      });
      writeStream.on('error', (err) => {
        logger.error('Failed to write docker image tar', { error: err.message });
        reject(err);
      });
      pack.finalize();
    });
  }

  /**
   * Helper to decompress gzip data
   */
  private async decompressGzip(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const zlib = require('zlib');
      zlib.gunzip(data, (err: Error | null, result: Buffer) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  /**
   * Format bytes to human readable string (KB, MB, GB)
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  /**
   * Format speed in bytes per second to human readable string
   */
  private formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
    return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  }

  /**
   * Get the path to the Docker-compatible image tar, creating it if needed
   * 
   * ============================================================================
   * TERMINAL FEATURE ONLY
   * ============================================================================
   * This method is used ONLY by the container terminal feature to get an image
   * that can be loaded into Docker/Podman. It is NOT used by any other feature.
   * ============================================================================
   */
  async getDockerImageTarPath(imageRef: string, forceRecreate: boolean = false): Promise<string> {
    if (forceRecreate) {
      const cached = await this.getCachedImage(imageRef);
      if (cached) {
        const imageCacheDir = path.dirname(cached.tarPath);
        const dockerImagePath = path.join(imageCacheDir, 'docker-image.tar');
        if (fs.existsSync(dockerImagePath)) {
          logger.info('Force recreating docker-image.tar', { imageRef });
          await fs.promises.unlink(dockerImagePath);
        }
      }
    }
    return this.createDockerImageTar(imageRef);
  }
}

export class AuthError extends Error {
  public details: { registry?: string; repository?: string; reason?: string; digest?: string; originalError?: string } | undefined;
  constructor(message: string, details?: { registry?: string; repository?: string; reason?: string; digest?: string; originalError?: string }) {
    super(message);
    this.name = 'AuthError';
    this.details = details;
  }
}
