import { create } from 'zustand';
import type { WebPreferences, WebShortcut } from '@mytermux/shared';
import { fetchWebPreferences, updateWebPreferences } from '../api';

export interface WebPreferencesState {
  preferences: WebPreferences | null;
  isLoading: boolean;
  error: string | null;
}

export interface WebPreferencesActions {
  loadPreferences: () => Promise<void>;
  savePreferences: (
    shortcuts: WebShortcut[],
    commonChars: string[],
    relayUrl: string | null,
    webLinkToken: string | null,
  ) => Promise<void>;
  setLocalPreferences: (preferences: WebPreferences) => void;
}

export const useWebPreferencesStore = create<WebPreferencesState & WebPreferencesActions>((set) => ({
  preferences: null,
  isLoading: false,
  error: null,

  loadPreferences: async () => {
    set({ isLoading: true, error: null });
    try {
      const preferences = await fetchWebPreferences();
      set({ preferences, isLoading: false, error: null });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : '加载偏好设置失败',
      });
      throw error;
    }
  },

  savePreferences: async (shortcuts, commonChars, relayUrl, webLinkToken) => {
    set({ isLoading: true, error: null });
    try {
      const preferences = await updateWebPreferences(shortcuts, commonChars, relayUrl, webLinkToken);
      set({ preferences, isLoading: false, error: null });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : '保存偏好设置失败',
      });
      throw error;
    }
  },

  setLocalPreferences: (preferences) => set({ preferences }),
}));
