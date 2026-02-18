import { describe, expect, it } from 'vitest';
import type { DaemonProfile } from '@mytermux/shared';
import { buildDefaultSessionOptions, resolveStartupCommand } from '../utils/sessionDefaults';

function createProfile(overrides: Partial<DaemonProfile> = {}): DaemonProfile {
  return {
    id: 'profile-1',
    name: 'Demo',
    hasToken: true,
    defaultCommandMode: 'zsh',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('Dashboard helpers', () => {
  describe('resolveStartupCommand', () => {
    it('should map zsh/bash/tmux mode to expected command', () => {
      expect(resolveStartupCommand(createProfile({ defaultCommandMode: 'zsh' }))).toBe('zsh');
      expect(resolveStartupCommand(createProfile({ defaultCommandMode: 'bash' }))).toBe('bash');
      expect(resolveStartupCommand(createProfile({ defaultCommandMode: 'tmux' }))).toBe('tmux');
    });

    it('should return custom command for custom mode', () => {
      expect(
        resolveStartupCommand(
          createProfile({ defaultCommandMode: 'custom', defaultCommandValue: 'htop' }),
        ),
      ).toBe('htop');
    });

    it('should return null when custom mode has empty value', () => {
      expect(
        resolveStartupCommand(
          createProfile({ defaultCommandMode: 'custom', defaultCommandValue: '   ' }),
        ),
      ).toBeNull();
    });
  });

  describe('buildDefaultSessionOptions', () => {
    it('should return undefined for null profile', () => {
      expect(buildDefaultSessionOptions(null)).toBeUndefined();
    });

    it('should include cwd and startupCommand when available', () => {
      const options = buildDefaultSessionOptions(
        createProfile({
          defaultCwd: '/tmp',
          defaultCommandMode: 'custom',
          defaultCommandValue: 'tmux',
        }),
      );

      expect(options).toEqual({
        cwd: '/tmp',
        startupCommand: 'tmux',
      });
    });

    it('should omit undefined options', () => {
      const options = buildDefaultSessionOptions(
        createProfile({
          defaultCwd: null,
          defaultCommandMode: 'custom',
          defaultCommandValue: null,
        }),
      );

      expect(options).toBeUndefined();
    });
  });
});
