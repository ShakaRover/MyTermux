import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DaemonProfile, DefaultCommandMode, WebShortcut } from '@mytermux/shared';
import {
  deleteDaemonProfile,
  fetchDaemons,
  patchDaemonProfile,
} from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebAuthStore } from '../stores/webAuthStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWebPreferencesStore } from '../stores/webPreferencesStore';

interface ProfileFormState {
  name: string;
  accessToken: string;
  defaultCwd: string;
  defaultCommandMode: DefaultCommandMode;
  defaultCommandValue: string;
  daemonId: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: '',
  accessToken: '',
  defaultCwd: '',
  defaultCommandMode: 'zsh',
  defaultCommandValue: '',
  daemonId: '',
};

function createShortcutId(): string {
  return `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DaemonHubPage() {
  const navigate = useNavigate();
  const { username, logout } = useWebAuthStore();
  const { state: connectionState, activeProfile } = useConnectionStore();
  const { connectWithProfile, isConnecting } = useWebSocket();

  const {
    preferences,
    loadPreferences,
    savePreferences,
    isLoading: prefsLoading,
    error: prefsError,
  } = useWebPreferencesStore();

  const [profiles, setProfiles] = useState<DaemonProfile[]>([]);
  const [onlineDaemons, setOnlineDaemons] = useState<Array<{ daemonId: string; connectedClients: number; lastHeartbeat: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionProfileId, setActionProfileId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  const [shortcutDraft, setShortcutDraft] = useState<WebShortcut[]>([]);
  const [commonCharsDraft, setCommonCharsDraft] = useState('');

  const currentModeLabel = '编辑在线配置';

  const refreshDaemons = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchDaemons();
      setProfiles(response.profiles);
      setOnlineDaemons(response.onlineDaemons);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '加载 daemon 列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDaemons();
    void loadPreferences().catch(() => undefined);
  }, [loadPreferences, refreshDaemons]);

  useEffect(() => {
    if (!preferences) {
      return;
    }

    setShortcutDraft(preferences.shortcuts);
    setCommonCharsDraft(preferences.commonChars.join(', '));
  }, [preferences]);

  const mapProfileToForm = useCallback((profile: DaemonProfile): ProfileFormState => ({
    name: profile.name,
    accessToken: '',
    defaultCwd: profile.defaultCwd ?? '',
    defaultCommandMode: profile.defaultCommandMode,
    defaultCommandValue: profile.defaultCommandValue ?? '',
    daemonId: profile.daemonId ?? '',
  }), []);

  useEffect(() => {
    if (profiles.length === 0) {
      setEditingProfileId(null);
      setForm(EMPTY_FORM);
      return;
    }

    const targetProfile = editingProfileId
      ? profiles.find((profile) => profile.id === editingProfileId) ?? profiles[0]
      : profiles[0];

    if (!targetProfile) {
      return;
    }

    if (editingProfileId !== targetProfile.id) {
      setEditingProfileId(targetProfile.id);
    }
    setForm((current) => ({
      ...mapProfileToForm(targetProfile),
      // 避免重置用户正在输入的新 token，除非切换编辑目标
      accessToken: editingProfileId === targetProfile.id ? current.accessToken : '',
    }));
  }, [editingProfileId, mapProfileToForm, profiles]);

  const resetForm = useCallback(() => {
    if (!editingProfileId) {
      setForm(EMPTY_FORM);
      return;
    }

    const profile = profiles.find((item) => item.id === editingProfileId);
    if (!profile) {
      setForm(EMPTY_FORM);
      return;
    }

    setForm(mapProfileToForm(profile));
  }, [editingProfileId, mapProfileToForm, profiles]);

  const handleStartEdit = useCallback((profile: DaemonProfile) => {
    setEditingProfileId(profile.id);
    setForm(mapProfileToForm(profile));
  }, [mapProfileToForm]);

  const handleSubmitProfile = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = form.name.trim();
    if (!name) {
      setError('配置名称不能为空');
      return;
    }

    if (!editingProfileId) {
      setError('当前没有可编辑的配置');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await patchDaemonProfile(editingProfileId, {
        name,
        defaultCwd: form.defaultCwd.trim() || null,
        defaultCommandMode: form.defaultCommandMode,
        defaultCommandValue: form.defaultCommandValue.trim() || null,
        ...(form.accessToken.trim() && { accessToken: form.accessToken.trim() }),
      });

      await refreshDaemons();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存配置失败');
    } finally {
      setSubmitting(false);
    }
  }, [editingProfileId, form, refreshDaemons]);

  const handleConnectProfile = useCallback(async (profile: DaemonProfile) => {
    setActionProfileId(profile.id);
    setError(null);

    try {
      await connectWithProfile(profile);
      navigate('/sessions');
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : '连接 daemon 失败');
    } finally {
      setActionProfileId(null);
    }
  }, [connectWithProfile, navigate]);

  const handleDeleteProfile = useCallback(async (profile: DaemonProfile) => {
    if (profile.online) {
      setError('在线 daemon 的配置不允许删除');
      return;
    }

    const confirmed = window.confirm(`确认删除离线配置「${profile.name}」吗？删除后不可恢复。`);
    if (!confirmed) {
      return;
    }

    setDeletingProfileId(profile.id);
    setError(null);

    try {
      await deleteDaemonProfile(profile.id);
      if (editingProfileId === profile.id) {
        setEditingProfileId(null);
        setForm(EMPTY_FORM);
      }
      await refreshDaemons();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除配置失败');
    } finally {
      setDeletingProfileId(null);
    }
  }, [editingProfileId, refreshDaemons]);

  const handleSavePreferences = useCallback(async () => {
    const normalizedChars = Array.from(new Set(
      commonCharsDraft
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ));

    try {
      await savePreferences(shortcutDraft, normalizedChars);
    } catch {
      // 错误已由 store 记录
    }
  }, [commonCharsDraft, savePreferences, shortcutDraft]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Daemon 管理中心</h1>
              <p className="text-sm text-gray-400 mt-1">
                登录用户: {username || 'unknown'}
                {' · '}
                连接状态: {connectionState}
                {activeProfile && (
                  <>
                    {' · '}
                    当前配置: {activeProfile.name}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/sessions')}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500"
              >
                前往会话
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-200 hover:bg-red-900/50"
              >
                退出登录
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
          <section className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Daemon 配置中心</h2>
                <p className="mt-1 text-xs text-gray-500">
                  在线 Daemon 与 profile 在这里统一管理：在线可编辑，离线可删除。
                </p>
              </div>
              <button
                onClick={() => void refreshDaemons()}
                disabled={loading}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-emerald-500 disabled:opacity-60"
              >
                {loading ? '刷新中...' : '刷新'}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                <p className="text-xs text-gray-500">在线 Daemon</p>
                <p className="mt-1 text-lg font-semibold text-emerald-400">{onlineDaemons.length}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                <p className="text-xs text-gray-500">Profile 总数</p>
                <p className="mt-1 text-lg font-semibold text-gray-100">{profiles.length}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                <p className="text-xs text-gray-500">已配置 Token</p>
                <p className="mt-1 text-lg font-semibold text-gray-100">
                  {profiles.filter((profile) => profile.hasToken).length}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
              <h3 className="text-base font-semibold">{currentModeLabel}</h3>
              <p className="mt-1 text-xs text-gray-500">每个 daemonId 自动对应一个 profile；在线可修改，离线仅支持手动删除。</p>

              <form className="mt-4 space-y-3" onSubmit={handleSubmitProfile}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="名称（例如：MacBook Pro）"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                  required
                />

                <input
                  type="text"
                  value={form.accessToken}
                  onChange={(event) => setForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                  placeholder="留空则不修改 Token"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-mono text-gray-100"
                />

                <input
                  type="text"
                  value={form.defaultCwd}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultCwd: event.target.value }))}
                  placeholder="默认目录（可选）"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                />

                <select
                  value={form.defaultCommandMode}
                  onChange={(event) => {
                    const value = event.target.value as DefaultCommandMode;
                    setForm((prev) => ({ ...prev, defaultCommandMode: value }));
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                >
                  <option value="zsh">zsh</option>
                  <option value="bash">bash</option>
                  <option value="tmux">tmux</option>
                  <option value="custom">custom</option>
                </select>

                {form.defaultCommandMode === 'custom' && (
                  <input
                    type="text"
                    value={form.defaultCommandValue}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultCommandValue: event.target.value }))}
                    placeholder="自定义启动命令"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                  />
                )}

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">绑定 daemonId（只读）</label>
                  <input
                    type="text"
                    value={form.daemonId || '暂无在线 daemon'}
                    readOnly
                    className="w-full rounded-lg border border-gray-700 bg-gray-800/70 px-3 py-2 text-sm text-gray-400"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={submitting || !editingProfileId}
                    className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {submitting ? '保存中...' : '保存修改'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={!editingProfileId}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500 disabled:opacity-60"
                  >
                    重置
                  </button>
                </div>
              </form>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
              <h3 className="text-base font-semibold">Daemon Profiles</h3>
              {profiles.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">当前没有在线 daemon，等待 daemon 上线后自动生成 profile。</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {profiles.map((profile) => {
                    const matchedOnlineDaemon = profile.daemonId
                      ? onlineDaemons.find((daemon) => daemon.daemonId === profile.daemonId)
                      : undefined;

                    return (
                      <div key={profile.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-gray-100">{profile.name}</p>
                              {activeProfile?.id === profile.id && (
                                <span className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-300">
                                  当前使用
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-400 break-all">
                              {profile.online ? '在线' : '离线'}
                              {' · '}
                              daemonId: {profile.daemonId || '未绑定'}
                              {' · '}
                              token: {profile.accessTokenMasked || '未设置'}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              默认目录: {profile.defaultCwd || '-'}
                              {' · '}
                              默认命令: {profile.defaultCommandMode}
                              {profile.defaultCommandValue ? ` (${profile.defaultCommandValue})` : ''}
                            </p>
                            {matchedOnlineDaemon && (
                              <p className="mt-1 text-xs text-emerald-300">
                                对应在线 daemon，客户端连接数: {matchedOnlineDaemon.connectedClients}
                                {' · '}
                                最后心跳: {new Date(matchedOnlineDaemon.lastHeartbeat).toLocaleString('zh-CN')}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {profile.online ? (
                              <button
                                onClick={() => handleStartEdit(profile)}
                                className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 hover:border-emerald-500"
                              >
                                编辑
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleDeleteProfile(profile)}
                                disabled={deletingProfileId === profile.id}
                                className="rounded-lg border border-red-800 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-60"
                              >
                                {deletingProfileId === profile.id ? '删除中...' : '删除'}
                              </button>
                            )}
                            <button
                              onClick={() => void handleConnectProfile(profile)}
                              disabled={isConnecting || actionProfileId === profile.id || !profile.hasToken || !profile.online}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                            >
                              连接
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 md:p-5">
              <h2 className="text-lg font-semibold">Web 快捷键配置</h2>
              <p className="mt-1 text-xs text-gray-500">
                这些配置会在移动端终端快捷栏中使用。
              </p>

              {prefsError && (
                <p className="mt-2 rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-300">
                  {prefsError}
                </p>
              )}

              <div className="mt-4 space-y-2">
                {shortcutDraft.map((shortcut, index) => (
                  <div key={shortcut.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      type="text"
                      value={shortcut.label}
                      onChange={(event) => {
                        const next = [...shortcutDraft];
                        next[index] = { ...shortcut, label: event.target.value };
                        setShortcutDraft(next);
                      }}
                      placeholder="标签"
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100"
                    />
                    <input
                      type="text"
                      value={shortcut.value}
                      onChange={(event) => {
                        const next = [...shortcutDraft];
                        next[index] = { ...shortcut, value: event.target.value };
                        setShortcutDraft(next);
                      }}
                      placeholder="发送值"
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShortcutDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
                      }}
                      className="rounded-md border border-red-800 px-2 text-xs text-red-300 hover:bg-red-900/30"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShortcutDraft((prev) => [
                    ...prev,
                    {
                      id: createShortcutId(),
                      label: 'New',
                      value: '',
                    },
                  ]);
                }}
                className="mt-3 rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 hover:border-emerald-500"
              >
                新增快捷键
              </button>

              <div className="mt-4">
                <label className="block text-xs text-gray-400 mb-1.5">常用字符（逗号分隔）</label>
                <textarea
                  value={commonCharsDraft}
                  onChange={(event) => setCommonCharsDraft(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-100"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleSavePreferences()}
                disabled={prefsLoading}
                className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {prefsLoading ? '保存中...' : '保存快捷键配置'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
