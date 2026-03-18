import { randomBytes } from 'node:crypto';

/** ws ticket 有效期（60 秒） */
export const WS_TICKET_TTL_MS = 60 * 1000;

/** ws ticket 元数据 */
export interface WsTicketPayload {
  ticket: string;
  profileId: string;
  daemonId?: string | null;
  /** 标准命名：MYTERMUX_DAEMON_TOKEN */
  daemonToken: string;
  /** 兼容旧字段：Access Token */
  accessToken: string;
  expiresAt: number;
  createdAt: number;
}

/** ws ticket 签发器 */
export class WsTicketService {
  private readonly tickets = new Map<string, WsTicketPayload>();

  issue(input: { profileId: string; daemonId?: string | null; daemonToken: string }): WsTicketPayload {
    this.pruneExpired();

    const now = Date.now();
    const ticket = randomBytes(24).toString('base64url');
    const payload: WsTicketPayload = {
      ticket,
      profileId: input.profileId,
      daemonToken: input.daemonToken,
      accessToken: input.daemonToken,
      createdAt: now,
      expiresAt: now + WS_TICKET_TTL_MS,
      ...(input.daemonId !== undefined && { daemonId: input.daemonId }),
    };

    this.tickets.set(ticket, payload);
    return payload;
  }

  consume(ticket: string): WsTicketPayload | null {
    const payload = this.tickets.get(ticket);
    if (!payload) {
      return null;
    }

    this.tickets.delete(ticket);

    if (payload.expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [ticket, payload] of this.tickets.entries()) {
      if (payload.expiresAt <= now) {
        this.tickets.delete(ticket);
      }
    }
  }
}
