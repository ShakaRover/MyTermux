import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo } from '@mytermux/shared';
import { useSessionsStore } from '../stores/sessionsStore';

function createSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    type: 'terminal',
    status: 'running',
    createdAt: Date.now(),
    title: `session-${id}`,
    ...overrides,
  };
}

describe('sessionsStore', () => {
  beforeEach(() => {
    useSessionsStore.getState().clearSessions();
  });

  it('setSessions should select first session when no active session', () => {
    useSessionsStore.getState().setSessions([
      createSession('s1'),
      createSession('s2'),
    ]);

    const state = useSessionsStore.getState();
    expect(state.activeSessionId).toBe('s1');
  });

  it('setSessions should keep active session when still exists', () => {
    const store = useSessionsStore.getState();
    store.setSessions([createSession('s1'), createSession('s2')]);
    store.setActiveSession('s2');

    store.setSessions([createSession('s1'), createSession('s2'), createSession('s3')]);

    const state = useSessionsStore.getState();
    expect(state.activeSessionId).toBe('s2');
  });

  it('setSessions should fallback to first session when active session disappears', () => {
    const store = useSessionsStore.getState();
    store.setSessions([createSession('s1'), createSession('s2')]);
    store.setActiveSession('s2');

    store.setSessions([createSession('s3'), createSession('s4')]);

    const state = useSessionsStore.getState();
    expect(state.activeSessionId).toBe('s3');
  });
});
