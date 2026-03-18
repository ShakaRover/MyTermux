import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebAuthStore } from '../stores/webAuthStore';

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { status, error, login, clearError } = useWebAuthStore();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      navigate('/daemons', { replace: true });
    }
  }, [status, navigate]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password) {
      return;
    }

    setSubmitting(true);
    clearError();

    try {
      await login(username.trim() || 'admin', password);
      navigate('/daemons', { replace: true });
    } catch (submitError) {
      console.error('登录失败:', submitError);
    } finally {
      setSubmitting(false);
    }
  }, [clearError, login, navigate, password, username]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900/90 shadow-xl shadow-black/30 p-6">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-100">MyTermux</h1>
          <p className="mt-2 text-sm text-gray-400">登录 Web 管理中心</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1.5">
              用户名
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              密码
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
              {toErrorMessage(error, '登录失败')}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-white font-medium hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500 text-center">
          使用 `RELAY_ADMIN_USERNAME` / `RELAY_ADMIN_PASSWORD_HASH` 登录。
        </p>
      </div>
    </div>
  );
}
