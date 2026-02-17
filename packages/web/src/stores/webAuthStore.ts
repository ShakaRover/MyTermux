/**
 * Web 登录会话 Store
 */

import { create } from 'zustand';
import { fetchWebSession, loginWebAdmin, logoutWebAdmin } from '../api';

export type WebAuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface WebAuthState {
  status: WebAuthStatus;
  username: string | null;
  error: string | null;
  initialized: boolean;
}

export interface WebAuthActions {
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useWebAuthStore = create<WebAuthState & WebAuthActions>((set) => ({
  status: 'checking',
  username: null,
  error: null,
  initialized: false,

  checkSession: async () => {
    set({ status: 'checking', error: null });

    try {
      const session = await fetchWebSession();
      set({
        status: session.authenticated ? 'authenticated' : 'unauthenticated',
        username: session.authenticated ? session.username : null,
        initialized: true,
        error: null,
      });
    } catch {
      set({
        status: 'unauthenticated',
        username: null,
        initialized: true,
      });
    }
  },

  login: async (username, password) => {
    set({ error: null });

    try {
      const session = await loginWebAdmin(username, password);
      set({
        status: session.authenticated ? 'authenticated' : 'unauthenticated',
        username: session.authenticated ? session.username : null,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({
        status: 'unauthenticated',
        username: null,
        initialized: true,
        error: error instanceof Error ? error.message : '登录失败',
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await logoutWebAdmin();
    } finally {
      set({
        status: 'unauthenticated',
        username: null,
        error: null,
        initialized: true,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
