import type {
  DaemonProfile,
  DefaultCommandMode,
  OnlineDaemon,
  WebPreferences,
  WebShortcut,
} from '@mytermux/shared';
import { apiRequest, resetCsrfTokenCache } from './client';

export interface WebAuthSession {
  authenticated: boolean;
  username: string;
  mustChangePassword: boolean;
  expiresAt: number;
}

interface LoginWebAuthResponse {
  authenticated?: boolean;
  success?: boolean;
  username: string;
  mustChangePassword?: boolean;
  expiresAt: number;
}

export interface DaemonListResponse {
  onlineDaemons: OnlineDaemon[];
  profiles: DaemonProfile[];
}

export interface WsTicketResponse {
  ticket: string;
  expiresAt: number;
  profileId: string;
  daemonId?: string | null;
}

export interface DaemonProfilePatchPayload {
  name?: string;
  daemonToken?: string | null;
  accessToken?: string | null;
  defaultCwd?: string | null;
  defaultCommandMode?: DefaultCommandMode;
  defaultCommandValue?: string | null;
}

export async function loginWebAdmin(username: string, password: string): Promise<WebAuthSession> {
  const response = await apiRequest<LoginWebAuthResponse>('/web-auth/login', {
    method: 'POST',
    body: {
      username,
      password,
    },
  });

  return {
    authenticated: response.authenticated ?? response.success ?? true,
    username: response.username,
    mustChangePassword: response.mustChangePassword ?? false,
    expiresAt: response.expiresAt,
  };
}

export async function updateWebAdminCredentials(username: string, password: string): Promise<WebAuthSession> {
  const response = await apiRequest<LoginWebAuthResponse>('/web-auth/change-credentials', {
    method: 'POST',
    requireCsrf: true,
    body: {
      username,
      password,
    },
  });

  return {
    authenticated: response.authenticated ?? response.success ?? true,
    username: response.username,
    mustChangePassword: response.mustChangePassword ?? false,
    expiresAt: response.expiresAt,
  };
}

export async function logoutWebAdmin(): Promise<void> {
  await apiRequest('/web-auth/logout', {
    method: 'POST',
    requireCsrf: true,
  });
  resetCsrfTokenCache();
}

export async function fetchWebSession(): Promise<WebAuthSession> {
  return apiRequest<WebAuthSession>('/web-auth/me');
}

export async function fetchDaemons(): Promise<DaemonListResponse> {
  return apiRequest<DaemonListResponse>('/daemons');
}

export async function patchDaemonProfile(profileId: string, payload: DaemonProfilePatchPayload): Promise<DaemonProfile> {
  const response = await apiRequest<{ profile: DaemonProfile }>(`/daemon-profiles/${profileId}`, {
    method: 'PATCH',
    requireCsrf: true,
    body: payload,
  });
  return response.profile;
}

export async function deleteDaemonProfile(profileId: string): Promise<void> {
  await apiRequest(`/daemon-profiles/${profileId}`, {
    method: 'DELETE',
    requireCsrf: true,
  });
}

export async function requestWsTicket(profileId: string, webLinkTokenInput?: string | null): Promise<WsTicketResponse> {
  const webLinkToken = webLinkTokenInput?.trim() || import.meta.env.VITE_MYTERMUX_WEB_LINK_TOKEN?.trim();

  return apiRequest<WsTicketResponse>('/ws-ticket', {
    method: 'POST',
    requireCsrf: true,
    body: {
      profileId,
      ...(webLinkToken ? { webLinkToken } : {}),
    },
  });
}

export async function fetchWebPreferences(): Promise<WebPreferences> {
  return apiRequest<WebPreferences>('/web-preferences');
}

export async function updateWebPreferences(
  shortcuts: WebShortcut[],
  commonChars: string[],
  relayUrl: string | null,
  webLinkToken: string | null,
): Promise<WebPreferences> {
  return apiRequest<WebPreferences>('/web-preferences', {
    method: 'PUT',
    requireCsrf: true,
    body: {
      shortcuts,
      commonChars,
      relayUrl,
      webLinkToken,
    },
  });
}
