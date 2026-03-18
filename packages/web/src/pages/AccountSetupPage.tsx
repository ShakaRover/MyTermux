import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebAuthStore } from '../stores/webAuthStore';

export function AccountSetupPage() {
  const navigate = useNavigate();
  const { username, updateCredentials, logout } = useWebAuthStore();

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return newUsername.trim().length >= 3 && newPassword.length >= 8 && confirmPassword.length >= 8;
  }, [confirmPassword.length, newPassword.length, newUsername]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedUsername = newUsername.trim();
    if (trimmedUsername.length < 3) {
      setError('用户名至少 3 个字符');
      return;
    }

    if (newPassword.length < 8) {
      setError('密码至少 8 位');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      await updateCredentials(trimmedUsername, newPassword);
      navigate('/daemons', { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '修改账号密码失败');
    } finally {
      setSubmitting(false);
    }
  }, [confirmPassword, navigate, newPassword, newUsername, updateCredentials]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900/90 shadow-xl shadow-black/30 p-6">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-100">首次安全配置</h1>
          <p className="mt-2 text-sm text-gray-400">
            已使用默认账号登录（当前账号: {username || 'admin'}），请先修改账号和密码后继续使用。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-username" className="block text-sm font-medium text-gray-300 mb-1.5">新用户名</label>
            <input
              id="new-username"
              type="text"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-300 mb-1.5">新密码</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-300 mb-1.5">确认新密码</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-white font-medium hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '保存中...' : '保存并继续'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-3 w-full rounded-lg border border-gray-700 py-2.5 text-sm text-gray-300 hover:border-gray-500"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
