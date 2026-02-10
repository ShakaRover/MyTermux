/**
 * 认证页面
 *
 * 用户输入 Access Token 与 daemon 建立连接
 * 支持令牌自动重连
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useConnectionStore } from '../stores/connectionStore';
import { ConnectionStatus } from '../components/ConnectionStatus';

/** 提取错误消息（纯函数，无需在组件内定义） */
function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * 认证页面组件
 */
export function PairingPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);
  const autoReconnectAttemptedRef = useRef(false);

  const { state } = useConnectionStore();

  const { connect, reconnectWithToken, disconnect, authenticate, isConnecting, hasSavedPairing, clearSavedPairing } = useWebSocket({
    onConnected: () => {
      setError(null);
    },
    onPaired: () => {
      // 认证成功，跳转到仪表盘
      navigate('/dashboard');
    },
    onError: (err) => {
      setError(err);
      setIsAutoReconnecting(false);
    },
    onReconnecting: (attempt) => {
      console.log(`正在自动重连 (第 ${attempt} 次尝试)...`);
    },
  });

  // 尝试使用保存的令牌自动重连
  useEffect(() => {
    if (autoReconnectAttemptedRef.current) {
      return;
    }

    if (state === 'disconnected' && hasSavedPairing) {
      autoReconnectAttemptedRef.current = true;
      setIsAutoReconnecting(true);
      setError(null);

      (async () => {
        try {
          const success = await reconnectWithToken();
          if (!success) {
            setIsAutoReconnecting(false);
            await connect();
          }
        } catch (err) {
          setIsAutoReconnecting(false);
          setError(toErrorMessage(err, '自动重连失败'));
          try {
            await connect();
          } catch (connectErr) {
            setError(toErrorMessage(connectErr, '连接失败'));
          }
        }
      })();
    } else if (state === 'disconnected') {
      autoReconnectAttemptedRef.current = true;
      connect().catch((err) => {
        setError(toErrorMessage(err, '连接失败'));
      });
    }
  }, [state, hasSavedPairing, reconnectWithToken, connect]);

  // 如果已认证，跳转到仪表盘
  useEffect(() => {
    if (state === 'paired') {
      navigate('/dashboard');
    }
  }, [state, navigate]);

  // 处理输入变化
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setToken(e.target.value.trim());
    },
    []
  );

  // 处理粘贴
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    setToken(pastedData);
  }, []);

  // 提交认证
  const handleSubmit = useCallback(async () => {
    if (!token) {
      setError('请输入 Access Token');
      return;
    }

    if (!token.startsWith('mycc-')) {
      setError('Access Token 格式无效（应以 mycc- 开头）');
      return;
    }

    setError(null);

    try {
      await authenticate(token);
    } catch (err) {
      setError(toErrorMessage(err, '认证失败'));
    }
  }, [token, authenticate]);

  const isAuthenticating = state === 'pairing';
  const canSubmit = state === 'connected' && token.startsWith('mycc-');

  // 处理回车提交
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && canSubmit) {
        // I5: 处理 handleSubmit 返回的 Promise，避免 unhandled rejection
        handleSubmit().catch((err) => {
          setError(toErrorMessage(err, '认证失败'));
        });
      }
    },
    [handleSubmit, canSubmit]
  );

  // 清除保存的认证信息，重新认证
  const handleClearAndReconnect = useCallback(() => {
    clearSavedPairing();
    setError(null);
    setIsAutoReconnecting(false);
    // 标记为已尝试过，防止 useEffect 再次触发 connect 导致双重连接
    autoReconnectAttemptedRef.current = true;
    // 先断开现有连接（清理可能存在的 CONNECTING/OPEN 状态的 WebSocket）
    disconnect();
    // 触发重新连接
    connect().catch((err) => {
      setError(toErrorMessage(err, '连接失败'));
    });
  }, [clearSavedPairing, disconnect, connect]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      {/* 连接状态 */}
      <div className="absolute top-4 right-4">
        <ConnectionStatus showDetails />
      </div>

      {/* Logo 和标题 */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-2xl bg-purple-600/20 text-purple-400">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-100 mb-2">MyCC</h1>
        <p className="text-gray-400">远程控制 Claude Code</p>
      </div>

      {/* 自动重连提示 */}
      {isAutoReconnecting && (
        <div className="w-full max-w-md p-6 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl mb-4">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-purple-500" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-gray-100 font-medium mb-2">正在自动重连...</p>
            <p className="text-gray-400 text-sm mb-4">检测到之前的认证信息，正在尝试自动重连</p>
            <button
              onClick={handleClearAndReconnect}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              取消并重新认证
            </button>
          </div>
        </div>
      )}

      {/* 认证卡片 */}
      {!isAutoReconnecting && (
        <div className="w-full max-w-md p-6 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl">
          <h2 className="text-lg font-semibold text-center text-gray-100 mb-2">
            输入 Access Token
          </h2>
          <p className="text-sm text-center text-gray-400 mb-6">
            在 daemon 终端中获取 Access Token
          </p>

          {/* Token 输入框 */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="mycc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={handleInputChange}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              disabled={isAuthenticating || isConnecting}
              className={`
                w-full px-4 py-3 text-sm font-mono
                bg-gray-800 border-2 rounded-lg
                text-gray-100 placeholder-gray-600
                focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
                ${token ? 'border-purple-500' : 'border-gray-700'}
              `}
            />
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isAuthenticating}
            className={`
              w-full py-3 rounded-lg font-medium
              transition-all duration-200
              ${
                canSubmit && !isAuthenticating
                  ? 'bg-purple-600 text-white hover:bg-purple-500'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {isAuthenticating ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                认证中...
              </span>
            ) : isConnecting ? (
              '连接中...'
            ) : (
              '连接 Daemon'
            )}
          </button>

          {/* 提示 */}
          <p className="text-xs text-center text-gray-500 mt-4">
            运行 <code className="text-purple-400">mycc start</code> 获取 Access Token
          </p>

          {/* 如果有保存的认证信息但自动重连失败，显示清除选项 */}
          {hasSavedPairing && !isAutoReconnecting && (
            <div className="mt-4 pt-4 border-t border-gray-800 text-center">
              <button
                onClick={handleClearAndReconnect}
                className="text-xs text-gray-500 hover:text-purple-400 transition-colors"
              >
                清除保存的认证信息
              </button>
            </div>
          )}
        </div>
      )}

      {/* 帮助链接 */}
      <div className="mt-8 text-center">
        <a
          href="https://github.com/mycc/mycc"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-purple-400 transition-colors"
        >
          需要帮助？查看文档
        </a>
      </div>
    </div>
  );
}
