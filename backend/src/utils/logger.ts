/**
 * Centralized logging utility with debug mode support
 * Debug logging is controlled by settings.debugLogging
 */

import fs from 'fs';
import path from 'path';

// Log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Global debug mode flag - updated by settings service
let debugModeEnabled = false;

// Log file path - will be set during init
let logFilePath: string | null = null;

/**
 * Initialize the logger with a log directory
 */
export function initLogger(logDir: string): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    logFilePath = path.join(logDir, `app-${timestamp}.log`);
  } catch (err) {
    console.error('Failed to initialize log directory:', err);
  }
}

/**
 * Set debug mode - called by settings service when settings load/change
 */
export function setDebugMode(enabled: boolean): void {
  debugModeEnabled = enabled;
  if (enabled) {
    log('info', 'Logger', 'Debug logging enabled');
  }
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return debugModeEnabled;
}

/**
 * Format log message with timestamp and level
 */
function formatMessage(level: LogLevel, component: string, message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}${dataStr}`;
}

/**
 * Write to log file if initialized
 */
function writeToFile(formattedMessage: string): void {
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, formattedMessage + '\n');
    } catch (err) {
      // Silently fail file logging
    }
  }
}

/**
 * Core logging function
 */
function log(level: LogLevel, component: string, message: string, data?: any): void {
  const formatted = formatMessage(level, component, message, data);
  
  // File and console output based on level and debug mode
  switch (level) {
    case 'debug':
      // Debug logs only written when debug mode is enabled
      if (debugModeEnabled) {
        writeToFile(formatted);
        console.log(formatted);
      }
      break;
    case 'info':
      writeToFile(formatted);
      console.log(formatted);
      break;
    case 'warn':
      writeToFile(formatted);
      console.warn(formatted);
      break;
    case 'error':
      writeToFile(formatted);
      console.error(formatted);
      break;
  }
}

/**
 * Create a logger instance for a specific component
 */
export function createLogger(component: string) {
  return {
    debug: (message: string, data?: any) => log('debug', component, message, data),
    info: (message: string, data?: any) => log('info', component, message, data),
    warn: (message: string, data?: any) => log('warn', component, message, data),
    error: (message: string, data?: any) => log('error', component, message, data),
    
    /**
     * Log HTTP request details - only in debug mode
     */
    httpRequest: (method: string, url: string, headers?: any, auth?: { username: string }) => {
      if (!debugModeEnabled) return;
      
      const maskedHeaders: any = {};
      if (headers) {
        for (const k of Object.keys(headers)) {
          const v = headers[k];
          if (!v) continue;
          // Mask bearer tokens
          if (typeof v === 'string' && v.toLowerCase().startsWith('bearer ')) {
            maskedHeaders[k] = `Bearer ${v.slice(7, 13)}...`;
          } else {
            maskedHeaders[k] = v;
          }
        }
      }
      
      log('debug', component, `HTTP ${method} ${url}`, {
        headers: Object.keys(maskedHeaders).length ? maskedHeaders : undefined,
        auth: auth ? `username=${auth.username}` : undefined
      });
    },
    
    /**
     * Log HTTP response details - only in debug mode
     */
    httpResponse: (status: number, url: string, dataPreview?: string) => {
      if (!debugModeEnabled) return;
      
      log('debug', component, `HTTP Response ${status} from ${url}`, {
        preview: dataPreview?.slice(0, 200)
      });
    },
    
    /**
     * Log download progress - always logs but with less detail unless debug mode
     */
    progress: (side: 'left' | 'right' | 'single', progressPct: number, status: string) => {
      const msg = `${side === 'single' ? 'Image' : side === 'left' ? 'Left image' : 'Right image'}: ${status} (${progressPct.toFixed(1)}%)`;
      log('info', component, msg);
    }
  };
}

// Default export for convenience
export default {
  initLogger,
  setDebugMode,
  isDebugMode,
  createLogger
};
