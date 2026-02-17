import type { DaemonProfile, SessionOptions } from '@opentermux/shared';

export function buildDefaultSessionOptions(profile: DaemonProfile | null): SessionOptions | undefined {
  if (!profile) {
    return undefined;
  }

  const options: SessionOptions = {};
  if (profile.defaultCwd) {
    options.cwd = profile.defaultCwd;
  }

  const startupCommand = resolveStartupCommand(profile);
  if (startupCommand) {
    options.startupCommand = startupCommand;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

export function resolveStartupCommand(profile: DaemonProfile): string | null {
  switch (profile.defaultCommandMode) {
    case 'zsh':
      return 'zsh';
    case 'bash':
      return 'bash';
    case 'tmux':
      return 'tmux';
    case 'custom':
      return profile.defaultCommandValue?.trim() || null;
    default:
      return null;
  }
}
