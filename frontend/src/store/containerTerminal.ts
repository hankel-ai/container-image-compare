/**
 * Container Terminal Store
 * 
 * ============================================================================
 * IMPORTANT: Docker/Podman Runtime Dependency Notice
 * ============================================================================
 * 
 * This store manages state for the interactive container terminal feature.
 * This feature requires Docker or Podman to be installed on the host system.
 * 
 * NO OTHER store or state management in this application requires Docker or Podman.
 * If no container runtime is detected, the terminal feature will be disabled
 * (grayed out in UI), but all other app features remain fully functional.
 * 
 * ============================================================================
 */

import { create } from 'zustand';

/**
 * Extract short name (repository:tag) from full image reference
 * e.g., "artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0" -> "dctm-tomcat:23.4.0"
 */
function getShortImageName(imageRef: string): string {
  const parts = imageRef.split('/');
  return parts[parts.length - 1] || imageRef;
}

/**
 * Container runtime information from backend
 */
export interface ContainerRuntimeInfo {
  available: boolean;
  runtime: 'docker' | 'podman' | 'none';
  version: string | null;
  message: string;
}

/**
 * Terminal session information
 */
export interface TerminalSession {
  sessionId: string;
  imageRef: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  workingDir?: string;  // Only set when explicitly specified (from Filesystem tab)
  runtime: 'docker' | 'podman';
  createdAt: string;
  containerId?: string;
  error?: string;
}

/**
 * Pending directory change request for an open terminal
 */
export interface PendingDirectoryChange {
  imageRef: string;
  path: string;
}

/**
 * Track open terminal tabs by image reference
 */
export interface OpenTerminalTab {
  imageRef: string;
  tabName: string;
  windowRef: Window | null;
}

interface ContainerTerminalState {
  // Runtime availability (fetched once on app load)
  runtimeInfo: ContainerRuntimeInfo | null;
  runtimeLoading: boolean;
  runtimeError: string | null;

  // Current terminal session
  currentSession: TerminalSession | null;
  sessionLoading: boolean;
  sessionError: string | null;

  // Terminal visibility
  isTerminalOpen: boolean;
  terminalWorkingDir: string;

  // Track open terminal tabs (for reusing existing tabs)
  openTerminalTabs: Map<string, OpenTerminalTab>;
  
  // Pending directory change (to send to existing terminal)
  pendingDirectoryChange: PendingDirectoryChange | null;

  // Actions
  fetchRuntimeStatus: () => Promise<void>;
  createSession: (imageRef: string, workingDir?: string) => Promise<TerminalSession | null>;
  terminateSession: () => Promise<void>;
  setTerminalOpen: (open: boolean, workingDir?: string) => void;
  clearError: () => void;
  
  // Terminal tab management
  openTerminalTab: (imageRef: string, workingDir?: string) => void;
  registerTerminalTab: (imageRef: string, windowRef: Window | null) => void;
  unregisterTerminalTab: (imageRef: string) => void;
  setPendingDirectoryChange: (imageRef: string, path: string) => void;
  clearPendingDirectoryChange: () => void;
}

export const useContainerTerminalStore = create<ContainerTerminalState>((set, get) => ({
  // Initial state
  runtimeInfo: null,
  runtimeLoading: false,
  runtimeError: null,
  currentSession: null,
  sessionLoading: false,
  sessionError: null,
  isTerminalOpen: false,
  terminalWorkingDir: '/',
  openTerminalTabs: new Map(),
  pendingDirectoryChange: null,

  /**
   * Fetch container runtime status from backend
   * Called once on app initialization to determine if terminal feature is available
   */
  fetchRuntimeStatus: async () => {
    set({ runtimeLoading: true, runtimeError: null });

    try {
      const response = await fetch('/api/container-terminal/status');
      const data = await response.json();

      set({
        runtimeInfo: {
          available: data.available,
          runtime: data.runtime || 'none',
          version: data.version,
          message: data.message
        },
        runtimeLoading: false
      });

      // Log to console for debugging
      if (data.available) {
        console.log(`✅ Container terminal: ${data.runtime} ${data.version} detected`);
      } else {
        console.log('⚠️ Container terminal: No Docker or Podman detected - feature disabled');
      }
    } catch (error: any) {
      console.error('Failed to fetch container runtime status:', error);
      set({
        runtimeInfo: {
          available: false,
          runtime: 'none',
          version: null,
          message: 'Failed to check container runtime status'
        },
        runtimeLoading: false,
        runtimeError: error.message
      });
    }
  },

  /**
   * Create a new terminal session for an image
   * Will retry if image is still being downloaded
   */
  createSession: async (imageRef: string, workingDir?: string) => {
    const { runtimeInfo, currentSession } = get();

    // Check if runtime is available
    if (!runtimeInfo?.available) {
      set({ sessionError: 'Container runtime not available' });
      return null;
    }

    // Terminate existing session first
    if (currentSession) {
      await get().terminateSession();
    }

    set({ sessionLoading: true, sessionError: null });

    // Retry loop for when image is being downloaded
    const maxRetries = 60; // Max 2 minutes of waiting (60 * 2 seconds)
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const response = await fetch('/api/container-terminal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageRef, ...(workingDir && { workingDir }) })
        });

        // Handle retry response (202) - image is being downloaded
        if (response.status === 202) {
          const retryData = await response.json();
          if (retryData.retry) {
            retryCount++;
            console.log(`Image download in progress, waiting... (attempt ${retryCount}/${maxRetries})`);
            set({ sessionError: `Waiting for image download... (${retryCount}s)` });
            await new Promise(resolve => setTimeout(resolve, retryData.retryAfterMs || 2000));
            continue;
          }
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to create terminal session');
        }

        const session: TerminalSession = await response.json();

        set({
          currentSession: session,
          sessionLoading: false,
          sessionError: null,
          isTerminalOpen: true,
          terminalWorkingDir: workingDir
        });

        console.log(`Terminal session created: ${session.sessionId}`);
        return session;
      } catch (error: any) {
        console.error('Failed to create terminal session:', error);
        set({
          sessionLoading: false,
          sessionError: error.message
        });
        return null;
      }
    }
    
    // Max retries exceeded
    set({
      sessionLoading: false,
      sessionError: 'Timeout waiting for image download. Please try again.'
    });
    return null;
  },

  /**
   * Terminate the current terminal session
   * Called when user navigates away or closes terminal
   */
  terminateSession: async () => {
    const { currentSession } = get();

    if (!currentSession) {
      return;
    }

    set({ sessionLoading: true });

    try {
      await fetch(`/api/container-terminal/session/${currentSession.sessionId}`, {
        method: 'DELETE'
      });

      console.log(`Terminal session terminated: ${currentSession.sessionId}`);
    } catch (error: any) {
      console.error('Failed to terminate terminal session:', error);
    } finally {
      set({
        currentSession: null,
        sessionLoading: false,
        isTerminalOpen: false
      });
    }
  },

  /**
   * Set terminal visibility
   */
  setTerminalOpen: (open: boolean, workingDir?: string) => {
    set({
      isTerminalOpen: open,
      ...(workingDir && { terminalWorkingDir: workingDir })
    });
  },

  /**
   * Clear error state
   */
  clearError: () => {
    set({ sessionError: null, runtimeError: null });
  },

  /**
   * Open terminal in a new browser tab, or focus existing tab
   * If terminal for this image is already open, switch to it and optionally change directory
   */
  openTerminalTab: (imageRef: string, workingDir?: string) => {
    const { openTerminalTabs } = get();
    const existingTab = openTerminalTabs.get(imageRef);
    
    // Encode the image ref for URL safety
    const encodedImageRef = encodeURIComponent(btoa(imageRef));
    const url = `/terminal/${encodedImageRef}${workingDir ? `?dir=${encodeURIComponent(workingDir)}` : ''}`;
    
    // Check if tab already exists and is still open
    if (existingTab && existingTab.windowRef && !existingTab.windowRef.closed) {
      // Focus the existing tab
      existingTab.windowRef.focus();
      
      // If a different working directory was requested, send a cd command
      if (workingDir && workingDir !== '/') {
        set({ pendingDirectoryChange: { imageRef, path: workingDir } });
        
        // Also try to communicate via localStorage for cross-tab messaging
        localStorage.setItem('terminal-cd-request', JSON.stringify({
          imageRef,
          path: workingDir,
          timestamp: Date.now()
        }));
      }
      return;
    }
    
    // Open new tab
    const newWindow = window.open(url, `terminal-${imageRef}`);
    
    if (newWindow) {
      // Register the new tab
      const newTabs = new Map(openTerminalTabs);
      newTabs.set(imageRef, {
        imageRef,
        tabName: getShortImageName(imageRef),
        windowRef: newWindow
      });
      set({ openTerminalTabs: newTabs });
      
      // Clean up when tab closes
      const checkClosed = setInterval(() => {
        if (newWindow.closed) {
          clearInterval(checkClosed);
          const { openTerminalTabs: currentTabs } = get();
          const updatedTabs = new Map(currentTabs);
          updatedTabs.delete(imageRef);
          set({ openTerminalTabs: updatedTabs });
        }
      }, 1000);
    }
  },

  /**
   * Register a terminal tab (called from TerminalPage)
   */
  registerTerminalTab: (imageRef: string, windowRef: Window | null) => {
    const { openTerminalTabs } = get();
    const newTabs = new Map(openTerminalTabs);
    newTabs.set(imageRef, {
      imageRef,
      tabName: getShortImageName(imageRef),
      windowRef
    });
    set({ openTerminalTabs: newTabs });
  },

  /**
   * Unregister a terminal tab (called when TerminalPage unmounts)
   */
  unregisterTerminalTab: (imageRef: string) => {
    const { openTerminalTabs } = get();
    const newTabs = new Map(openTerminalTabs);
    newTabs.delete(imageRef);
    set({ openTerminalTabs: newTabs });
  },

  /**
   * Set a pending directory change for an open terminal
   */
  setPendingDirectoryChange: (imageRef: string, path: string) => {
    set({ pendingDirectoryChange: { imageRef, path } });
  },

  /**
   * Clear the pending directory change
   */
  clearPendingDirectoryChange: () => {
    set({ pendingDirectoryChange: null });
  }
}));
