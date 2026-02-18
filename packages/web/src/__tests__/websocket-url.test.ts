import { afterEach, describe, expect, it } from 'vitest';
import { buildWsUrl } from '../hooks/useWebSocket';

describe('buildWsUrl', () => {
  const windowHolder = globalThis as unknown as { window?: { location: { protocol: string; host: string } } };
  const originalWindow = windowHolder.window;

  afterEach(() => {
    if (originalWindow) {
      windowHolder.window = originalWindow;
    } else {
      delete windowHolder.window;
    }
  });

  it('should append ticket to absolute ws url', () => {
    const url = buildWsUrl('ws://localhost:3000/ws', 'ticket-123');
    expect(url).toBe('ws://localhost:3000/ws?ticket=ticket-123');
  });

  it('should append ticket with ampersand when query exists', () => {
    const url = buildWsUrl('ws://localhost:3000/ws?foo=bar', 'ticket-123');
    expect(url).toBe('ws://localhost:3000/ws?foo=bar&ticket=ticket-123');
  });

  it('should resolve relative path with current window host', () => {
    windowHolder.window = {
      location: {
        protocol: 'https:',
        host: 'mytermux.example.com',
      },
    };

    const url = buildWsUrl('/ws', 'ticket-123');
    expect(url).toBe('wss://mytermux.example.com/ws?ticket=ticket-123');
  });
});
