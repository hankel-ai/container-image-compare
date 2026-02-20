import { create } from 'zustand';
import { ComparisonResult } from '../../../shared/types';

interface ProgressState {
  left: { percent: number; status: string; speedBps?: number };
  right: { percent: number; status: string; speedBps?: number };
}

interface ComparisonStore {
  currentComparison: ComparisonResult | null;
  loading: boolean;
  error: string | null;
  progress: ProgressState | null;
  authDetails?: { registry?: string; repository?: string; reason?: string; side?: string; image?: string } | null;
  
  // Flag to indicate images have identical digests
  imagesIdentical: boolean;
  identicalDigest: string | null;
  
  // Persisted input fields across tab navigation
  leftImageInput: string;
  rightImageInput: string;
  setLeftImageInput: (value: string) => void;
  setRightImageInput: (value: string) => void;
  
  // Auto-submit flag for repull from history
  autoSubmit: boolean;
  setAutoSubmit: (value: boolean) => void;
  
  // Clear the identical images notification
  clearImagesIdentical: () => void;
  
  startComparison: (leftImage: string, rightImage: string, leftCredentialId?: string, rightCredentialId?: string) => Promise<void>;
  loadComparison: (id: string) => Promise<void>;
  clearComparison: () => void;
}

export const useComparisonStore = create<ComparisonStore>((set) => ({
  currentComparison: null,
  loading: false,
  error: null,
  progress: null,
  authDetails: null,
  
  // Images identical tracking
  imagesIdentical: false,
  identicalDigest: null,
  
  // Image inputs persist across tab navigation
  leftImageInput: '',
  rightImageInput: '',
  setLeftImageInput: (value) => set({ leftImageInput: value }),
  setRightImageInput: (value) => set({ rightImageInput: value }),
  
  // Auto-submit flag for repull from history
  autoSubmit: false,
  setAutoSubmit: (value) => set({ autoSubmit: value }),
  
  // Clear identical images notification
  clearImagesIdentical: () => set({ imagesIdentical: false, identicalDigest: null }),

  startComparison: async (leftImage, rightImage, leftCredentialId?: string, rightCredentialId?: string) => {
    set({ 
      loading: true, 
      error: null, 
      progress: { 
        left: { percent: 0, status: 'Starting...' }, 
        right: { percent: 0, status: 'Waiting...' } 
      }, 
      authDetails: null,
      imagesIdentical: false,
      identicalDigest: null
    });
    
    return new Promise<void>((resolve) => {
      const body: any = { leftImage, rightImage };
      if (leftCredentialId) body.leftCredentialId = leftCredentialId;
      if (rightCredentialId) body.rightCredentialId = rightCredentialId;

      // Use fetch with SSE by creating a POST request with streaming response
      fetch('/api/comparison/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async response => {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          set({ error: 'Failed to connect to server', loading: false, progress: null });
          resolve();
          return;
        }

        const processChunk = async () => {
          const { done, value } = await reader.read();
          
          if (value) {
            buffer += decoder.decode(value, { stream: true });
          }
          
          // Parse SSE messages - each message ends with \n\n
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || ''; // Keep incomplete message in buffer

          for (const message of messages) {
            if (!message.trim()) continue;
            
            const lines = message.split('\n');
            let eventType = '';
            let eventData = '';
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }
            
            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                
                if (eventType === 'progress') {
                  set(state => ({
                    progress: {
                      left: data.side === 'left' 
                        ? { percent: data.percent, status: data.status, speedBps: data.speedBps } 
                        : (state.progress?.left || { percent: 0, status: '' }),
                      right: data.side === 'right' 
                        ? { percent: data.percent, status: data.status, speedBps: data.speedBps } 
                        : (state.progress?.right || { percent: 0, status: '' })
                    }
                  }));
                } else if (eventType === 'info') {
                  // Handle info events like identical images notification
                  if (data.type === 'identical_images') {
                    set({ 
                      imagesIdentical: true,
                      identicalDigest: data.digest || null
                    });
                  }
                } else if (eventType === 'complete') {
                  set({ 
                    currentComparison: data, 
                    loading: false, 
                    progress: null,
                    error: null,
                    authDetails: null
                  });
                } else if (eventType === 'error') {
                  const details = data.details || null;
                  set({ 
                    error: data.message || 'An error occurred', 
                    loading: false, 
                    progress: null,
                    authDetails: details
                  });
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }

          // If done, resolve and exit
          if (done) {
            resolve();
            return;
          }

          // Continue reading
          await processChunk();
        };

        await processChunk();
      }).catch(error => {
        set({ 
          error: error.message || 'Failed to start comparison', 
          loading: false, 
          progress: null 
        });
        resolve();
      });
    });
  },

  loadComparison: async (id) => {
    set({ loading: true, error: null });
    
    try {
      const response = await fetch(`/api/comparison/${id}`);
      if (!response.ok) throw new Error('Failed to load comparison');
      
      const result = await response.json();
      set({ currentComparison: result, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  clearComparison: () => {
    set({ currentComparison: null, error: null, progress: null });
  },
}));
