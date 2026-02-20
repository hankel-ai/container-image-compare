import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { AppSettings, RegistryCredential } from '../../../shared/types';
import { setDebugMode, initLogger } from '../utils/logger';

// Consolidated app data directory structure:
// appdata/
//   settings.json  - Application settings and credentials
//   cache/         - Downloaded image layers and filesystem tars (default, can be changed)
//   history/       - Comparison result history files
//   logs/          - Application log files
const APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(process.cwd(), 'appdata');
const SETTINGS_FILE = path.join(APP_DATA_DIR, 'settings.json');
const DEFAULT_CACHE_DIR = path.join(APP_DATA_DIR, 'cache');
const HISTORY_DIR = path.join(APP_DATA_DIR, 'history');
const LOGS_DIR = path.join(APP_DATA_DIR, 'logs');
const TEMP_DIR = path.join(APP_DATA_DIR, 'temp');

const DEFAULT_SETTINGS: AppSettings = {
  cacheDir: DEFAULT_CACHE_DIR,
  maxCacheSizeGB: parseInt(process.env.MAX_CACHE_SIZE_GB || '20'),
  maxHistoryItems: parseInt(process.env.MAX_HISTORY_ITEMS || '20'),
  theme: 'auto',
  showOnlyDifferences: false,
  caseSensitiveSearch: false,
  debugLogging: process.env.DEBUG_LOGGING === 'true',
  // PORT is used by portable launcher, FRONTEND_PORT is alternative env var name
  frontendPort: parseInt(process.env.PORT || process.env.FRONTEND_PORT || '5000'),
  skipTlsVerify: true,  // Skip TLS/SSL certificate verification (for self-signed certs)
  httpProxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '',  // HTTP proxy URL
  noProxy: process.env.NO_PROXY || process.env.no_proxy || '',  // Hosts to bypass proxy
  insecureRegistries: process.env.INSECURE_REGISTRIES ? process.env.INSECURE_REGISTRIES.split(',').map(s => s.trim()) : []  // HTTP-only registries
};

// Export paths for use by other services - cache is dynamic and read from currentCacheDir
let currentCacheDir = DEFAULT_CACHE_DIR;

export const APP_PATHS = {
  appData: APP_DATA_DIR,
  settings: SETTINGS_FILE,
  get cache() { return currentCacheDir; },
  history: HISTORY_DIR,
  logs: LOGS_DIR,
  temp: TEMP_DIR,
  defaultCache: DEFAULT_CACHE_DIR
};

export class SettingsService {
  private settings: AppSettings = DEFAULT_SETTINGS;
  private credentials: RegistryCredential[] = [];
  private credKey: Buffer | null = null;

  async init(): Promise<void> {
    // Create all appdata subdirectories including cache
    await fs.mkdir(APP_DATA_DIR, { recursive: true });
    await fs.mkdir(DEFAULT_CACHE_DIR, { recursive: true });
    await fs.mkdir(HISTORY_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    
    // Initialize logger with logs directory
    initLogger(LOGS_DIR);
    
    // Set up encryption key for credentials
    const key = process.env.CIC_CRED_KEY || process.env.CIC_CREDENTIAL_KEY;
    if (key) {
      // Expect a base64 encoded 32-byte key or raw passphrase
      try {
        this.credKey = Buffer.from(key, 'base64');
        if (this.credKey.length !== 32) this.credKey = crypto.createHash('sha256').update(key).digest();
      } catch {
        this.credKey = crypto.createHash('sha256').update(key).digest();
      }
    } else {
      // Generate a default key based on the app data directory path (machine-specific)
      // This provides basic encryption without requiring environment variable setup
      const defaultSeed = `container-image-compare-${APP_DATA_DIR}-${process.cwd()}`;
      this.credKey = crypto.createHash('sha256').update(defaultSeed).digest();
    }
    await this.load();
    // Note: Cache directory is created lazily when needed by imageCacheOCI
  }

  private async load(): Promise<void> {
    try {
      let data = await fs.readFile(SETTINGS_FILE, 'utf-8');
      // Strip UTF-8 BOM if present (PowerShell on Windows may add this)
      if (data.charCodeAt(0) === 0xFEFF) {
        data = data.slice(1);
      }
      const parsed = JSON.parse(data);
      // Merge saved settings over defaults, but preserve saved values (don't let env defaults override)
      const savedSettings = parsed.settings || parsed;
      this.settings = { ...DEFAULT_SETTINGS };
      
      // Copy all saved settings, preserving their values over environment defaults
      for (const key of Object.keys(savedSettings)) {
        if (savedSettings[key] !== undefined && savedSettings[key] !== null) {
          (this.settings as any)[key] = savedSettings[key];
        }
      }
      
      // Override certain settings from environment variables (deployment config takes precedence)
      // These env vars come from Kubernetes/Docker deployment and should always be used
      if (process.env.INSECURE_REGISTRIES) {
        this.settings.insecureRegistries = process.env.INSECURE_REGISTRIES.split(',').map(s => s.trim());
      }
      if (process.env.NO_PROXY || process.env.no_proxy) {
        this.settings.noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
      }
      if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
        this.settings.httpProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '';
      }
      // Override cache/history limits from environment if set (pod deployment takes precedence)
      if (process.env.MAX_CACHE_SIZE_GB) {
        this.settings.maxCacheSizeGB = parseInt(process.env.MAX_CACHE_SIZE_GB);
      }
      if (process.env.MAX_HISTORY_ITEMS) {
        this.settings.maxHistoryItems = parseInt(process.env.MAX_HISTORY_ITEMS);
      }
      
      // Update global cache directory if custom cacheDir is set
      if (this.settings.cacheDir && this.settings.cacheDir !== DEFAULT_CACHE_DIR) {
        currentCacheDir = this.settings.cacheDir;
        // Ensure custom cache directory exists
        await fs.mkdir(currentCacheDir, { recursive: true });
      } else {
        this.settings.cacheDir = DEFAULT_CACHE_DIR;
        currentCacheDir = DEFAULT_CACHE_DIR;
      }
      
      // Apply debug logging setting
      setDebugMode(this.settings.debugLogging);
      
      this.credentials = (parsed.credentials || []).map((c: RegistryCredential) => {
        if (c.password && this.credKey) {
          try {
            const buf = Buffer.from(c.password, 'base64');
            const iv = buf.slice(0, 12);
            const tag = buf.slice(12, 28);
            const ciphertext = buf.slice(28);
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.credKey as Buffer, iv);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            c.password = decrypted.toString('utf-8');
          } catch {
            // leave as-is
          }
        }
        return c;
      });
    } catch (err) {
      // Settings file doesn't exist or is invalid - use defaults and create the file
      console.log(`Settings file not found or invalid, creating with defaults: ${err}`);
      this.settings = { ...DEFAULT_SETTINGS };
      this.credentials = [];
      // Create the settings.json file with defaults so we don't get this error on every startup
      await this.save();
    }
  }

  private async save(): Promise<void> {
    const payload = {
      settings: this.settings,
      credentials: this.credentials.map(c => {
        const copy = { ...c } as RegistryCredential;
        if (copy.password && this.credKey) {
          try {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', this.credKey as Buffer, iv);
            const encrypted = Buffer.concat([cipher.update(Buffer.from(copy.password, 'utf-8')), cipher.final()]);
            const tag = cipher.getAuthTag();
            const out = Buffer.concat([iv, tag, encrypted]).toString('base64');
            copy.password = out;
          } catch {
            // fallback: leave plain
          }
        }
        return copy;
      })
    };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(payload, null, 2));
  }

  // Synchronous getter for current settings (use after init)
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  async get(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async getCredentials(): Promise<RegistryCredential[]> {
    // Reload from disk to pick up any credentials added via settings API
    await this.load();
    return this.credentials.map(c => ({ ...c }));
  }

  async addOrUpdateCredential(cred: RegistryCredential): Promise<RegistryCredential> {
    // Check for existing credential with same registry (case-insensitive)
    // Only ONE credential per exact registry is allowed
    const existingByRegistry = this.credentials.find(c => 
      c.registry.toLowerCase() === cred.registry.toLowerCase()
    );
    
    if (existingByRegistry) {
      // Update the existing credential for this registry
      Object.assign(existingByRegistry, {
        username: cred.username,
        password: cred.password,
        name: cred.name,
        createdAt: cred.createdAt || existingByRegistry.createdAt
      });
      await this.save();
      return existingByRegistry;
    } else {
      // Add new credential
      this.credentials.push(cred);
      await this.save();
      return cred;
    }
  }

  async deleteCredential(id: string): Promise<void> {
    this.credentials = this.credentials.filter(c => c.id !== id);
    await this.save();
  }

  async update(updates: Partial<AppSettings>): Promise<AppSettings> {
    // Handle cacheDir separately - use moveCache() for that
    const { cacheDir, ...safeUpdates } = updates;
    this.settings = { ...this.settings, ...safeUpdates };
    
    // Apply debug logging if changed
    if ('debugLogging' in safeUpdates) {
      setDebugMode(this.settings.debugLogging);
    }
    
    await this.save();
    return { ...this.settings };
  }

  async moveCache(newCacheDir: string): Promise<{ success: boolean; movedFiles: number; error?: string }> {
    const oldCacheDir = currentCacheDir;
    
    // Normalize the path
    newCacheDir = path.resolve(newCacheDir);
    
    // Don't do anything if same directory
    if (newCacheDir === oldCacheDir) {
      return { success: true, movedFiles: 0 };
    }
    
    try {
      // Create the new cache directory
      await fs.mkdir(newCacheDir, { recursive: true });
      
      // Check if old cache directory exists and has contents
      let movedFiles = 0;
      try {
        const oldContents = await fs.readdir(oldCacheDir);
        
        // Move each item from old to new
        for (const item of oldContents) {
          const oldPath = path.join(oldCacheDir, item);
          const newPath = path.join(newCacheDir, item);
          
          try {
            // Try rename first (fast if same filesystem)
            await fs.rename(oldPath, newPath);
            movedFiles++;
          } catch (renameErr: any) {
            // If rename fails (cross-filesystem), copy and delete
            if (renameErr.code === 'EXDEV') {
              await this.copyRecursive(oldPath, newPath);
              await fs.rm(oldPath, { recursive: true, force: true });
              movedFiles++;
            } else {
              throw renameErr;
            }
          }
        }
        
        // Try to remove the old cache directory if empty
        try {
          await fs.rmdir(oldCacheDir);
        } catch {
          // Directory might not be empty or might not exist, ignore
        }
      } catch (err: any) {
        // Old cache dir doesn't exist or is empty - that's fine
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      
      // Update settings and global cache path
      this.settings.cacheDir = newCacheDir;
      currentCacheDir = newCacheDir;
      await this.save();
      
      return { success: true, movedFiles };
    } catch (err: any) {
      return { success: false, movedFiles: 0, error: err.message };
    }
  }
  
  private async copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await fs.stat(src);
    
    if (stat.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      const items = await fs.readdir(src);
      for (const item of items) {
        await this.copyRecursive(path.join(src, item), path.join(dest, item));
      }
    } else {
      await fs.copyFile(src, dest);
    }
  }

  async reset(): Promise<AppSettings> {
    this.settings = DEFAULT_SETTINGS;
    currentCacheDir = DEFAULT_CACHE_DIR;
    await this.save();
    return { ...this.settings };
  }
}

// Singleton instance for use by other services
export const settingsService = new SettingsService();
