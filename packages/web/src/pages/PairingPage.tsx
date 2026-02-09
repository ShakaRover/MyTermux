/**
 * 配对页面
 *
 * 用户输入 6 位配对码与 daemon 建立连接
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useConnectionStore } from '../stores/connectionStore';
import { ConnectionStatus } from '../components/ConnectionStatus';

/**
 * 配对页面组件
 */
export function PairingPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { state } = useConnectionStore();

  const { connect, pair, isConnecting } = useWebSocket({
    onConnected: () => {
      setError(null);
    },
    onPaired: () => {
      // 配对成功，跳转到仪表盘
      navigate('/dashboard');
    },
    onError: (err) => {
      setError(err);
    },
  });

  // 自动连接到中继服务器
  useEffect(() => {
    if (state === 'disconnected') {
      connect().catch((err) => {
        setError(err instanceof Error ? err.message : '连接失败');
      });
    }
  }, [state, connect]);

  // 如果已配对，跳转到仪表盘
  useEffect(() => {
    if (state === 'paired') {
      navigate('/dashboard');
    }
  }, [state, navigate]);

  // 处理输入变化
  const handleInputChange = useCallback(
    (index: number, value: string) => {
      // 只允许数字
      const digit = value.replace(/\D/g, '').slice(-1);

      const newCode = [...code];
      newCode[index] = digit;
      setCode(newCode);

      // 自动跳转到下一个输入框
      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [code]
  );

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !code[index] && index > 0) {
        // 回退到上一个输入框
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === 'ArrowRight' && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [code]
  );

  // 处理粘贴
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);

    if (pastedData.length > 0) {
      const newCode = [...code];
      for (let i = 0; i < pastedData.length; i++) {
        newCode[i] = pastedData[i] || '';
      }
      setCode(newCode);

      // 聚焦到最后一个填充的输入框
      const focusIndex = Math.min(pastedData.length, 5);
      inputRefs.current[focusIndex]?.focus();
    }
  }, [code]);

  // 提交配对
  const handleSubmit = useCallback(async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      setError('请输入完整的 6 位配对码');
      return;
    }

    setError(null);

    try {
      await pair(fullCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配对失败');
    }
  }, [code, pair]);

  // 当所有数字输入完成时自动提交
  useEffect(() => {
    if (code.every((d) => d) && state === 'connected') {
      handleSubmit();
    }
  }, [code, state, handleSubmit]);

  const isPairing = state === 'pairing';
  const canSubmit = state === 'connected' && code.every((d) => d);

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

      {/* 配对卡片 */}
      <div className="w-full max-w-md p-6 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl">
        <h2 className="text-lg font-semibold text-center text-gray-100 mb-2">
          输入配对码
        </h2>
        <p className="text-sm text-center text-gray-400 mb-6">
          在 daemon 终端中获取 6 位配对码
        </p>

        {/* 配对码输入 */}
        <div className="flex justify-center gap-2 mb-6" onPaste={handlePaste}>
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleInputChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              disabled={isPairing || isConnecting}
              className={`
                w-12 h-14 text-center text-2xl font-mono font-bold
                bg-gray-800 border-2 rounded-lg
                text-gray-100
                focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
                ${digit ? 'border-purple-500' : 'border-gray-700'}
              `}
            />
          ))}
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
          disabled={!canSubmit || isPairing}
          className={`
            w-full py-3 rounded-lg font-medium
            transition-all duration-200
            ${
              canSubmit && !isPairing
                ? 'bg-purple-600 text-white hover:bg-purple-500'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {isPairing ? (
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
              配对中...
            </span>
          ) : isConnecting ? (
            '连接中...'
          ) : (
            '开始配对'
          )}
        </button>

        {/* 提示 */}
        <p className="text-xs text-center text-gray-500 mt-4">
          配对码有效期为 5 分钟
        </p>
      </div>

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
