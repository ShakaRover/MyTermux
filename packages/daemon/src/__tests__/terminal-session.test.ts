import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeMock = vi.fn();
const resizeMock = vi.fn();
const killMock = vi.fn();

let onDataHandler: ((data: string) => void) | null = null;
let onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null;

vi.mock('node-pty', () => {
  return {
    spawn: vi.fn(() => ({
      pid: 4321,
      process: 'bash',
      cols: 80,
      rows: 24,
      write: writeMock,
      resize: resizeMock,
      kill: killMock,
      onData: (handler: (data: string) => void) => {
        onDataHandler = handler;
      },
      onExit: (handler: (event: { exitCode: number; signal?: number }) => void) => {
        onExitHandler = handler;
      },
    })),
  };
});

import { TerminalSession } from '../terminal-session';

describe('TerminalSession', () => {
  beforeEach(() => {
    writeMock.mockClear();
    resizeMock.mockClear();
    killMock.mockClear();
    onDataHandler = null;
    onExitHandler = null;
  });

  it('should include pid in session info', async () => {
    const session = new TerminalSession('session-1');
    await session.start();

    const info = session.getInfo();
    expect(info.pid).toBe(4321);
  });

  it('should write startupCommand after pty starts', async () => {
    const session = new TerminalSession('session-2', {
      startupCommand: 'tmux',
    });

    await session.start();
    expect(writeMock).toHaveBeenCalledWith('tmux\r');
  });

  it('should keep behavior unchanged when startupCommand is empty', async () => {
    const session = new TerminalSession('session-3');
    await session.start();

    expect(writeMock).not.toHaveBeenCalled();

    onDataHandler?.('hello');
    onExitHandler?.({ exitCode: 0 });

    expect(session.getInfo().status).toBe('stopped');
  });
});
