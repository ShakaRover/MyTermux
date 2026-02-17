/**
 * Web API 客户端
 *
 * 统一处理：
 * - credentials (Cookie 会话)
 * - JSON 编码
 * - CSRF Token 自动注入（写操作）
 * - 错误提取
 */

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

let csrfTokenCache: string | null = null;

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  requireCsrf?: boolean;
}

/** 清空 CSRF 缓存（如登出后） */
export function resetCsrfTokenCache(): void {
  csrfTokenCache = null;
}

/** 通用 API 请求 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.requireCsrf && method !== 'GET') {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
  }

  const response = await fetch(resolveApiUrl(path), {
    method,
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
  });

  if (response.status === 401) {
    csrfTokenCache = null;
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

/** 获取并缓存 CSRF Token */
export async function ensureCsrfToken(): Promise<string> {
  if (csrfTokenCache) {
    return csrfTokenCache;
  }

  const response = await fetch(resolveApiUrl('/web-auth/csrf'), {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const data = await response.json() as { csrfToken?: string };
  if (!data.csrfToken) {
    throw new Error('CSRF Token 获取失败');
  }

  csrfTokenCache = data.csrfToken;
  return data.csrfToken;
}

function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as { message?: string; error?: string };
    if (data.message) {
      return data.message;
    }
    if (data.error) {
      return data.error;
    }
  } catch {
    // ignore
  }

  return `请求失败 (${response.status})`;
}
