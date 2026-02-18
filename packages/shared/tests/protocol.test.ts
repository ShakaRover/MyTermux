import { describe, it, expect } from 'vitest';
import {
  createTransportMessage,
  generateMessageId,
  isTransportMessage,
  isAppMessage,
} from '../src/protocol';
import type {
  TransportMessage,
  SessionCreateMessage,
} from '../src/protocol';

describe('Protocol Module', () => {
  describe('createTransportMessage', () => {
    it('should create a valid transport message', () => {
      const message = createTransportMessage(
        'message',
        'device-123',
        '{"encrypted": "payload"}'
      );

      expect(message.type).toBe('message');
      expect(message.from).toBe('device-123');
      expect(message.payload).toBe('{"encrypted": "payload"}');
      expect(message.timestamp).toBeDefined();
      expect(message.to).toBeUndefined();
    });

    it('should include recipient when provided', () => {
      const message = createTransportMessage(
        'message',
        'device-123',
        'payload',
        'device-456'
      );

      expect(message.to).toBe('device-456');
    });

    it('should set correct timestamp', () => {
      const before = Date.now();
      const message = createTransportMessage('heartbeat', 'device', '');
      const after = Date.now();

      expect(message.timestamp).toBeGreaterThanOrEqual(before);
      expect(message.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('generateMessageId', () => {
    it('should generate a unique message ID', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();

      expect(id1).not.toBe(id2);
    });

    it('should include timestamp in the ID', () => {
      const id = generateMessageId();
      const parts = id.split('-');
      const timestamp = Number(parts[0]);

      expect(timestamp).toBeGreaterThan(Date.now() - 1000);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('isTransportMessage', () => {
    it('should return true for valid transport messages', () => {
      const message: TransportMessage = {
        type: 'message',
        from: 'device-123',
        payload: 'test',
        timestamp: Date.now(),
      };

      expect(isTransportMessage(message)).toBe(true);
    });

    it('should return true for token_auth messages', () => {
      const message: TransportMessage = {
        type: 'token_auth',
        from: 'client-123',
        payload: JSON.stringify({ deviceType: 'client', publicKey: 'key', accessToken: 'mytermux-abc' }),
        timestamp: Date.now(),
      };

      expect(isTransportMessage(message)).toBe(true);
    });

    it('should return true for token_ack messages', () => {
      const message: TransportMessage = {
        type: 'token_ack',
        from: 'relay',
        payload: JSON.stringify({ success: true, daemonId: 'daemon-1', publicKey: 'key' }),
        timestamp: Date.now(),
      };

      expect(isTransportMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isTransportMessage(null)).toBe(false);
      expect(isTransportMessage(undefined)).toBe(false);
      expect(isTransportMessage({})).toBe(false);
      expect(isTransportMessage({ type: 'message' })).toBe(false);
      expect(isTransportMessage({ type: 'message', from: 'x' })).toBe(false);
    });
  });

  describe('isAppMessage', () => {
    it('should return true for valid app messages', () => {
      const message: SessionCreateMessage = {
        action: 'session:create',
        sessionType: 'terminal',
      };

      expect(isAppMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isAppMessage(null)).toBe(false);
      expect(isAppMessage(undefined)).toBe(false);
      expect(isAppMessage({})).toBe(false);
      expect(isAppMessage({ type: 'message' })).toBe(false);
    });
  });
});
