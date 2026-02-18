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
  expiresAt: number;
}

interface LoginWebAuthResponse {
  authenticated?: boolean;
  success?: boolean;
  username: string;
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

export interface DaemonProfilePayload {
  name: string;
  accessToken?: string | null;
  daemonId?: string | null;
  defaultCwd?: string | null;
  defaultCommandMode: DefaultCommandMode;
  defaultCommandValue?: string | null;
}

export interface DaemonProfilePatchPayload {
  name?: string;
  accessToken?: string | null;
  daemonId?: string | null;
  defaultCwd?: string | null;
  defaultCommandMode?: DefaultCommandMode;
  defaultCommandValue?: string | null;
}

export async function loginWebAdmin(username: string, password: string): Promise<WebAuthSession> {
  const response = await apiRequest<LoginWebAuthResponse>('/web-auth/login', {
    method: 'POST',
    body: { username, password },
  });

  return {
    authenticated: response.authenticated ?? response.success ?? true,
    username: response.username,
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

export async function createDaemonProfile(payload: DaemonProfilePayload): Promise<DaemonProfile> {
  const response = await apiRequest<{ profile: DaemonProfile }>('/daemon-profiles', {
    method: 'POST',
    requireCsrf: true,
    body: payload,
  });
  return response.profile;
}

export async function patchDaemonProfile(profileId: string, payload: DaemonProfilePatchPayload): Promise<DaemonProfile> {
  const response = await apiRequest<{ profile: DaemonProfile }>(`/daemon-profiles/${profileId}`, {
    method: 'PATCH',
    requireCsrf: true,
    body: payload,
  });
  return response.profile;
}

export async function bindDaemonProfile(profileId: string, daemonId: string | null): Promise<DaemonProfile> {
  const response = await apiRequest<{ profile: DaemonProfile }>(`/daemon-profiles/${profileId}/bind`, {
    method: 'POST',
    requireCsrf: true,
    body: { daemonId },
  });
  return response.profile;
}

export async function requestWsTicket(profileId: string): Promise<WsTicketResponse> {
  return apiRequest<WsTicketResponse>('/ws-ticket', {
    method: 'POST',
    requireCsrf: true,
    body: { profileId },
  });
}

export async function fetchWebPreferences(): Promise<WebPreferences> {
  return apiRequest<WebPreferences>('/web-preferences');
}

export async function updateWebPreferences(shortcuts: WebShortcut[], commonChars: string[]): Promise<WebPreferences> {
  return apiRequest<WebPreferences>('/web-preferences', {
    method: 'PUT',
    requireCsrf: true,
    body: {
      shortcuts,
      commonChars,
    },
  });
}
