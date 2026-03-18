import { localDbDelete, localDbGet, localDbSet } from './localDatabase';

export interface LocalWebAuthSession {
  authenticated: boolean;
  username: string;
  mustChangePassword: boolean;
  expiresAt: number;
}

interface StoredWebAdminAccount {
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
  updatedAt: number;
}

interface StoredWebSession {
  username: string;
  expiresAt: number;
}

const ACCOUNT_KEY = 'web.auth.account.v1';
const SESSION_KEY = 'web.auth.session.v1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'mytermux';

function unauthenticatedSession(): LocalWebAuthSession {
  return {
    authenticated: false,
    username: '',
    mustChangePassword: false,
    expiresAt: 0,
  };
}

function requireSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto');
  }
  return globalThis.crypto.subtle;
}

async function sha256(text: string): Promise<string> {
  const subtle = requireSubtleCrypto();
  const data = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureAdminAccount(): Promise<StoredWebAdminAccount> {
  const existing = await localDbGet<StoredWebAdminAccount>(ACCOUNT_KEY);
  if (existing && existing.username && existing.passwordHash) {
    return existing;
  }

  const account: StoredWebAdminAccount = {
    username: DEFAULT_USERNAME,
    passwordHash: await sha256(DEFAULT_PASSWORD),
    mustChangePassword: true,
    updatedAt: Date.now(),
  };
  await localDbSet(ACCOUNT_KEY, account);
  return account;
}

export async function getLocalWebSession(): Promise<LocalWebAuthSession> {
  const account = await ensureAdminAccount();
  const session = await localDbGet<StoredWebSession>(SESSION_KEY);
  if (!session) {
    return unauthenticatedSession();
  }

  if (!session.username || session.expiresAt <= Date.now() || session.username !== account.username) {
    await localDbDelete(SESSION_KEY);
    return unauthenticatedSession();
  }

  return {
    authenticated: true,
    username: account.username,
    mustChangePassword: account.mustChangePassword,
    expiresAt: session.expiresAt,
  };
}

export async function loginLocalWebAdmin(username: string, password: string): Promise<LocalWebAuthSession> {
  const account = await ensureAdminAccount();
  const inputUsername = username.trim();
  if (!inputUsername || !password) {
    throw new Error('用户名和密码不能为空');
  }

  if (inputUsername !== account.username) {
    throw new Error('用户名或密码错误');
  }

  const inputHash = await sha256(password);
  if (inputHash !== account.passwordHash) {
    throw new Error('用户名或密码错误');
  }

  const expiresAt = Date.now() + SESSION_TTL_MS;
  await localDbSet(SESSION_KEY, { username: account.username, expiresAt } satisfies StoredWebSession);

  return {
    authenticated: true,
    username: account.username,
    mustChangePassword: account.mustChangePassword,
    expiresAt,
  };
}

export async function updateLocalWebAdminCredentials(
  username: string,
  password: string,
): Promise<LocalWebAuthSession> {
  const currentSession = await getLocalWebSession();
  if (!currentSession.authenticated) {
    throw new Error('请先登录');
  }

  const oldAccount = await ensureAdminAccount();
  const newUsername = username.trim();
  const newPassword = password.trim();
  if (!newUsername || !newPassword) {
    throw new Error('新用户名和新密码不能为空');
  }
  if (newUsername.length < 3 || newUsername.length > 64) {
    throw new Error('用户名长度必须在 3-64 之间');
  }
  if (newPassword.length < 8) {
    throw new Error('密码长度至少 8 位');
  }

  const newHash = await sha256(newPassword);
  if (oldAccount.mustChangePassword) {
    if (newUsername === oldAccount.username) {
      throw new Error('首次修改时必须更换用户名');
    }
    if (newHash === oldAccount.passwordHash) {
      throw new Error('首次修改时必须更换密码');
    }
  }

  const updatedAccount: StoredWebAdminAccount = {
    username: newUsername,
    passwordHash: newHash,
    mustChangePassword: false,
    updatedAt: Date.now(),
  };
  await localDbSet(ACCOUNT_KEY, updatedAccount);

  const expiresAt = Date.now() + SESSION_TTL_MS;
  await localDbSet(SESSION_KEY, { username: newUsername, expiresAt } satisfies StoredWebSession);

  return {
    authenticated: true,
    username: newUsername,
    mustChangePassword: false,
    expiresAt,
  };
}

export async function logoutLocalWebAdmin(): Promise<void> {
  await localDbDelete(SESSION_KEY);
}
