/**
 * 新建会话对话框组件
 *
 * 用于创建新的 Claude 或终端会话
 */

import { useState, useCallback } from 'react';
import type { SessionType } from '@mycc/shared';

/** 新建会话对话框 Props */
export interface NewSessionDialogProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 创建会话回调 */
  onCreate: (type: SessionType, cwd?: string) => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 新建会话对话框组件
 */
export function NewSessionDialog({
  isOpen,
  onClose,
  onCreate,
  className = '',
}: NewSessionDialogProps) {
  const [selectedType, setSelectedType] = useState<SessionType>('claude');
  const [cwd, setCwd] = useState('');

  const handleCreate = useCallback(() => {
    onCreate(selectedType, cwd.trim() || undefined);
    // 重置表单
    setSelectedType('claude');
    setCwd('');
    onClose();
  }, [selectedType, cwd, onCreate, onClose]);

  const handleClose = useCallback(() => {
    // 重置表单
    setSelectedType('claude');
    setCwd('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        bg-black/60 backdrop-blur-sm
        ${className}
      `}
      onClick={handleClose}
    >
      <div
        className="
          w-full max-w-md mx-4 p-6
          bg-gray-900 border border-gray-700 rounded-2xl
          shadow-2xl shadow-purple-900/20
          animate-in fade-in zoom-in-95 duration-200
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-100">新建会话</h3>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 会话类型选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">
            会话类型
          </label>
          <div className="grid grid-cols-2 gap-3">
            {/* Claude 选项 */}
            <button
              onClick={() => setSelectedType('claude')}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-xl border
                transition-all duration-200
                ${
                  selectedType === 'claude'
                    ? 'bg-purple-900/40 border-purple-500 text-purple-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }
              `}
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <span className="font-medium">Claude</span>
              <span className="text-xs opacity-60">AI 对话</span>
            </button>

            {/* 终端选项 */}
            <button
              onClick={() => setSelectedType('terminal')}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-xl border
                transition-all duration-200
                ${
                  selectedType === 'terminal'
                    ? 'bg-emerald-900/40 border-emerald-500 text-emerald-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }
              `}
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="font-medium">终端</span>
              <span className="text-xs opacity-60">Shell 命令</span>
            </button>
          </div>
        </div>

        {/* 工作目录输入 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            工作目录 <span className="text-gray-500">(可选)</span>
          </label>
          <input
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="例如: /home/user/projects"
            className="
              w-full px-4 py-3 rounded-lg
              bg-gray-800 border border-gray-700
              text-gray-100 placeholder-gray-500
              focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
              transition-all duration-200
            "
          />
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="
              flex-1 px-4 py-2.5 rounded-lg
              bg-gray-800 border border-gray-700
              text-gray-300 font-medium
              hover:bg-gray-700 hover:border-gray-600
              transition-all duration-200
            "
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            className={`
              flex-1 px-4 py-2.5 rounded-lg
              border font-medium
              transition-all duration-200
              ${
                selectedType === 'claude'
                  ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-500'
                  : 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500'
              }
            `}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
