import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWebSession: vi.fn(),
  loginWebAdmin: vi.fn(),
  logoutWebAdmin: vi.fn(),
}));

import { fetchWebSession, loginWebAdmin, logoutWebAdmin } from '../api';
import { useWebAuthStore } from '../stores/webAuthStore';

describe('webAuthStore', () => {
  beforeEach(() => {
    useWebAuthStore.setState({
      status: 'checking',
      username: null,
      error: null,
      initialized: false,
    });
    vi.clearAllMocks();
  });

  it('checkSession should set authenticated state on success', async () => {
    vi.mocked(fetchWebSession).mockResolvedValue({
      authenticated: true,
      username: 'admin',
      expiresAt: Date.now() + 60_000,
    });

    await useWebAuthStore.getState().checkSession();

    const state = useWebAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.username).toBe('admin');
    expect(state.initialized).toBe(true);
  });

  it('login should set authenticated state on success', async () => {
    vi.mocked(loginWebAdmin).mockResolvedValue({
      authenticated: true,
      username: 'admin',
      expiresAt: Date.now() + 60_000,
    });

    await useWebAuthStore.getState().login('admin', 'secret-pass');

    const state = useWebAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.username).toBe('admin');
    expect(state.error).toBeNull();
    expect(state.initialized).toBe(true);
  });

  it('login should set error and rethrow when request fails', async () => {
    vi.mocked(loginWebAdmin).mockRejectedValue(new Error('bad credentials'));

    await expect(useWebAuthStore.getState().login('admin', 'wrong')).rejects.toThrow('bad credentials');

    const state = useWebAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.error).toBe('bad credentials');
  });

  it('logout should always reset to unauthenticated', async () => {
    useWebAuthStore.setState({
      status: 'authenticated',
      username: 'admin',
      error: null,
      initialized: true,
    });
    vi.mocked(logoutWebAdmin).mockResolvedValue(undefined);

    await useWebAuthStore.getState().logout();

    const state = useWebAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.username).toBeNull();
    expect(state.initialized).toBe(true);
  });
});
