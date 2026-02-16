import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatHostForUrl,
  resolveHealthProbeHosts,
  fetchHealthStatus,
} from '../health-check';

function createMockResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('health-check utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('formatHostForUrl', () => {
    it('should keep ipv4 host unchanged', () => {
      expect(formatHostForUrl('127.0.0.1')).toBe('127.0.0.1');
    });

    it('should wrap ipv6 host with brackets', () => {
      expect(formatHostForUrl('::1')).toBe('[::1]');
    });

    it('should keep bracketed ipv6 host unchanged', () => {
      expect(formatHostForUrl('[::1]')).toBe('[::1]');
    });
  });

  describe('resolveHealthProbeHosts', () => {
    it('should fallback wildcard ipv4 host to local probe hosts', () => {
      expect(resolveHealthProbeHosts('0.0.0.0')).toEqual(['127.0.0.1', 'localhost']);
    });

    it('should fallback wildcard ipv6 host to local probe hosts', () => {
      expect(resolveHealthProbeHosts('::')).toEqual(['::1', '127.0.0.1', 'localhost']);
    });

    it('should keep explicit host as single probe host', () => {
      expect(resolveHealthProbeHosts('192.168.1.10')).toEqual(['192.168.1.10']);
    });
  });

  describe('fetchHealthStatus', () => {
    it('should retry with fallback hosts when wildcard host is provided', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(createMockResponse(true, { status: 'ok' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchHealthStatus('0.0.0.0', 3000);

      expect(result).toEqual({ status: 'ok' });
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/health');
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:3000/health');
    });

    it('should return null when all probes fail', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchHealthStatus('0.0.0.0', 3000);

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

