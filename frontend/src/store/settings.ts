import { create } from 'zustand';
import { AppSettings, RegistryCredential } from '../../../shared/types';

interface TestCredentialResult {
  success: boolean;
  error?: string;
  message?: string;
}

interface SettingsStore {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  credentials: RegistryCredential[];
  loadCredentials: () => Promise<void>;
  saveCredential: (cred: RegistryCredential) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  testCredential: (registry: string, username: string, password: string) => Promise<TestCredentialResult>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loading: false,
  error: null,
  credentials: [],

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to load settings');
      const settings = await response.json();
      set({ settings, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  updateSettings: async (updates) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      const settings = await response.json();
      set({ settings, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  loadCredentials: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/settings/credentials');
      if (!res.ok) throw new Error('Failed to load credentials');
      const credentials = await res.json();
      set({ credentials, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  saveCredential: async (cred) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cred)
      });
      if (!res.ok) throw new Error('Failed to save credential');
      // refresh list
      const listRes = await fetch('/api/settings/credentials');
      const credentials = await listRes.json();
      set({ credentials, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  deleteCredential: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/settings/credentials/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete credential');
      const listRes = await fetch('/api/settings/credentials');
      const credentials = await listRes.json();
      set({ credentials, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  testCredential: async (registry, username, password) => {
    try {
      const res = await fetch('/api/settings/credentials/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registry, username, password })
      });
      const result = await res.json();
      return result;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to test credential' };
    }
  }
}));
