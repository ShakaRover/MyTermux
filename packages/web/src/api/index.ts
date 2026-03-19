import type {
  DaemonProfile,
  DefaultCommandMode,
  OnlineDaemon,
  WebPreferences,
  WebShortcut,
} from '@mytermux/shared';
import { apiRequest } from './client';
import {
  getLocalWebPreferences,
  saveLocalWebPreferences,
} from '../storage/webPreferencesDatabase';

export interface WebAuthSession {
  authenticated: boolean;
  username: string;
  mustChangePassword: boolean;
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
  return apiRequest<WebAuthSession>('/web-auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export async function updateWebAdminCredentials(username: string, password: string): Promise<WebAuthSession> {
  return apiRequest<WebAuthSession>('/web-auth/update-credentials', {
    method: 'POST',
    body: { username, password },
  });
}

export async function logoutWebAdmin(): Promise<void> {
  await apiRequest('/web-auth/logout', {
    method: 'POST',
  });
}

export async function fetchWebSession(): Promise<WebAuthSession> {
  return apiRequest<WebAuthSession>('/web-auth/session');
}

export async function fetchDaemons(): Promise<DaemonListResponse> {
  return apiRequest<DaemonListResponse>('/daemons');
}

export async function patchDaemonProfile(profileId: string, payload: DaemonProfilePatchPayload): Promise<DaemonProfile> {
  const response = await apiRequest<{ profile: DaemonProfile }>(`/daemon-profiles/${profileId}`, {
    method: 'PATCH',
    body: payload,
  });
  return response.profile;
}

export async function deleteDaemonProfile(profileId: string): Promise<void> {
  await apiRequest(`/daemon-profiles/${profileId}`, { method: 'DELETE' });
}

export async function requestWsTicket(profileId: string): Promise<WsTicketResponse> {
  return apiRequest<WsTicketResponse>('/ws-ticket', {
    method: 'POST',
    body: { profileId },
  });
}

export async function fetchWebPreferences(): Promise<WebPreferences> {
  return getLocalWebPreferences();
}

export async function updateWebPreferences(
  shortcuts: WebShortcut[],
  commonChars: string[],
): Promise<WebPreferences> {
  return saveLocalWebPreferences(shortcuts, commonChars);
}
