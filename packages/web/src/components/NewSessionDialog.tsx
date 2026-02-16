/**
 * 新建会话对话框组件
 *
 * 用于创建新的终端会话
 */

import { useState, useCallback } from 'react';

/** 新建会话对话框 Props */
export interface NewSessionDialogProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 创建会话回调 */
  onCreate: (cwd?: string) => void;
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
  const [cwd, setCwd] = useState('');

  const handleCreate = useCallback(() => {
    onCreate(cwd.trim() || undefined);
    // 重置表单
    setCwd('');
    onClose();
  }, [cwd, onCreate, onClose]);

  const handleClose = useCallback(() => {
    // 重置表单
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

        {/* 会话模式说明 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            会话模式
          </label>
          <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/70 text-gray-300">
            <p className="text-sm font-medium text-emerald-300">统一终端会话</p>
            <p className="text-xs text-gray-400 mt-1">
              在会话中可直接运行任意 CLI 命令。
            </p>
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
            className="
              flex-1 px-4 py-2.5 rounded-lg
              border border-emerald-500 font-medium
              bg-emerald-600 text-white hover:bg-emerald-500
              transition-all duration-200
            "
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
