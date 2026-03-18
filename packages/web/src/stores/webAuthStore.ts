/**
 * Web 登录会话 Store
 */

import { create } from 'zustand';
import { fetchWebSession, loginWebAdmin, logoutWebAdmin, updateWebAdminCredentials } from '../api';

export type WebAuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface WebAuthState {
  status: WebAuthStatus;
  username: string | null;
  mustChangePassword: boolean;
  error: string | null;
  initialized: boolean;
}

export interface WebAuthActions {
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  updateCredentials: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useWebAuthStore = create<WebAuthState & WebAuthActions>((set) => ({
  status: 'checking',
  username: null,
  mustChangePassword: false,
  error: null,
  initialized: false,

  checkSession: async () => {
    set({ status: 'checking', error: null });

    try {
      const session = await fetchWebSession();
      set({
        status: session.authenticated ? 'authenticated' : 'unauthenticated',
        username: session.authenticated ? session.username : null,
        mustChangePassword: session.authenticated ? session.mustChangePassword : false,
        initialized: true,
        error: null,
      });
    } catch {
      set({
        status: 'unauthenticated',
        username: null,
        mustChangePassword: false,
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
        mustChangePassword: session.authenticated ? session.mustChangePassword : false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({
        status: 'unauthenticated',
        username: null,
        mustChangePassword: false,
        initialized: true,
        error: error instanceof Error ? error.message : '登录失败',
      });
      throw error;
    }
  },

  updateCredentials: async (username, password) => {
    set({ error: null });

    try {
      const session = await updateWebAdminCredentials(username, password);
      set({
        status: session.authenticated ? 'authenticated' : 'unauthenticated',
        username: session.authenticated ? session.username : null,
        mustChangePassword: session.authenticated ? session.mustChangePassword : false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '更新账号密码失败',
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
        mustChangePassword: false,
        error: null,
        initialized: true,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
