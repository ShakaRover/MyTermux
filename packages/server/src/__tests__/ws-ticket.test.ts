import { describe, expect, it, vi } from 'vitest';
import { WsTicketService } from '../auth/ws-ticket';

describe('WsTicketService', () => {
  it('should issue and consume ticket once', () => {
    const service = new WsTicketService();
    const ticket = service.issue({
      profileId: 'profile-1',
      daemonId: 'daemon-1',
      daemonToken: 'mytermux-token',
    });

    const first = service.consume(ticket.ticket);
    const second = service.consume(ticket.ticket);

    expect(first?.profileId).toBe('profile-1');
    expect(first?.daemonToken).toBe('mytermux-token');
    expect(first?.accessToken).toBe('mytermux-token');
    expect(second).toBeNull();
  });

  it('should reject expired ticket', () => {
    const service = new WsTicketService();
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const ticket = service.issue({
      profileId: 'profile-2',
      daemonToken: 'mytermux-token-2',
    });

    vi.setSystemTime(now + 61_000);
    const consumed = service.consume(ticket.ticket);
    expect(consumed).toBeNull();

    vi.useRealTimers();
  });
});
