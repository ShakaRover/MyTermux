import type { WebPreferences, WebShortcut } from '@mytermux/shared';
import { localDbGet, localDbSet } from './localDatabase';

const PREFERENCES_KEY = 'web.preferences.v1';

export const DEFAULT_WEB_SHORTCUTS: WebShortcut[] = [
  { id: 'ctrl-c', label: 'Ctrl+C', value: '\u0003' },
  { id: 'ctrl-v', label: 'Ctrl+V', value: '\u0016' },
  { id: 'ctrl-d', label: 'Ctrl+D', value: '\u0004' },
  { id: 'ctrl-z', label: 'Ctrl+Z', value: '\u001A' },
  { id: 'ctrl-l', label: 'Ctrl+L', value: '\u000C' },
  { id: 'esc', label: 'Esc', value: '\u001B' },
  { id: 'tab', label: 'Tab', value: '\t' },
  { id: 'arrow-up', label: '↑', value: '\u001B[A' },
  { id: 'arrow-down', label: '↓', value: '\u001B[B' },
  { id: 'arrow-left', label: '←', value: '\u001B[D' },
  { id: 'arrow-right', label: '→', value: '\u001B[C' },
];

export const DEFAULT_COMMON_CHARS = ['/', '~', '|', '&', ';', '$', '*', '{}', '[]', '()'];

function sanitizeShortcuts(input: unknown): WebShortcut[] {
  if (!Array.isArray(input)) {
    return DEFAULT_WEB_SHORTCUTS;
  }

  const normalized: WebShortcut[] = [];
  for (const item of input) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>)['id'] !== 'string' ||
      typeof (item as Record<string, unknown>)['label'] !== 'string' ||
      typeof (item as Record<string, unknown>)['value'] !== 'string'
    ) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = String(record['id']).trim();
    const label = String(record['label']).trim();
    const value = String(record['value']);
    if (!id || !label) {
      continue;
    }
    normalized.push({ id, label, value });
  }

  return normalized.length > 0 ? normalized : DEFAULT_WEB_SHORTCUTS;
}

function sanitizeCommonChars(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return DEFAULT_COMMON_CHARS;
  }
  const dedup = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = item.trim();
    if (normalized) {
      dedup.add(normalized);
    }
  }
  return dedup.size > 0 ? Array.from(dedup) : DEFAULT_COMMON_CHARS;
}

function sanitizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function defaultPreferences(): WebPreferences {
  return {
    shortcuts: DEFAULT_WEB_SHORTCUTS,
    commonChars: DEFAULT_COMMON_CHARS,
    relayUrl: null,
    webLinkToken: null,
    updatedAt: Date.now(),
  };
}

export async function getLocalWebPreferences(): Promise<WebPreferences> {
  const raw = await localDbGet<WebPreferences>(PREFERENCES_KEY);
  if (!raw) {
    const defaults = defaultPreferences();
    await localDbSet(PREFERENCES_KEY, defaults);
    return defaults;
  }

  return {
    shortcuts: sanitizeShortcuts(raw.shortcuts),
    commonChars: sanitizeCommonChars(raw.commonChars),
    relayUrl: sanitizeOptionalString(raw.relayUrl),
    webLinkToken: sanitizeOptionalString(raw.webLinkToken),
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now(),
  };
}

export async function saveLocalWebPreferences(
  shortcuts: WebShortcut[],
  commonChars: string[],
  relayUrl: string | null,
  webLinkToken: string | null,
): Promise<WebPreferences> {
  const next: WebPreferences = {
    shortcuts: sanitizeShortcuts(shortcuts),
    commonChars: sanitizeCommonChars(commonChars),
    relayUrl: sanitizeOptionalString(relayUrl),
    webLinkToken: sanitizeOptionalString(webLinkToken),
    updatedAt: Date.now(),
  };
  await localDbSet(PREFERENCES_KEY, next);
  return next;
}

export async function getRelayWebLinkToken(): Promise<string | null> {
  const preferences = await getLocalWebPreferences();
  return preferences.webLinkToken;
}
