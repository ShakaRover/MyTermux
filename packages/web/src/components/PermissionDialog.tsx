/**
 * 权限审批弹窗组件
 *
 * 显示 Claude 请求的权限，供用户批准或拒绝
 */

import { useCallback } from 'react';
import type { PermissionRequest } from '@mycc/shared';

/** 权限弹窗 Props */
export interface PermissionDialogProps {
  /** 权限请求 */
  request: PermissionRequest;
  /** 批准回调 */
  onApprove: (requestId: string) => void;
  /** 拒绝回调 */
  onReject: (requestId: string) => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 权限审批弹窗组件
 */
export function PermissionDialog({
  request,
  onApprove,
  onReject,
  className = '',
}: PermissionDialogProps) {
  const handleApprove = useCallback(() => {
    onApprove(request.id);
  }, [request.id, onApprove]);

  const handleReject = useCallback(() => {
    onReject(request.id);
  }, [request.id, onReject]);

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        bg-black/60 backdrop-blur-sm
        ${className}
      `}
    >
      <div
        className="
          w-full max-w-md mx-4 p-6
          bg-gray-900 border border-gray-700 rounded-2xl
          shadow-2xl shadow-purple-900/20
          animate-in fade-in zoom-in-95 duration-200
        "
      >
        {/* 图标 */}
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-yellow-900/30 text-yellow-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        {/* 标题 */}
        <h3 className="text-lg font-semibold text-center text-gray-100 mb-2">
          权限请求
        </h3>

        {/* 工具名称 */}
        <div className="text-center mb-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-purple-900/40 text-purple-300 text-sm font-mono">
            {request.tool}
          </span>
        </div>

        {/* 描述 */}
        <div className="p-4 mb-6 bg-gray-800 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-300 whitespace-pre-wrap">
            {request.description}
          </p>
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3">
          <button
            onClick={handleReject}
            className="
              flex-1 px-4 py-2.5 rounded-lg
              bg-gray-800 border border-gray-700
              text-gray-300 font-medium
              hover:bg-gray-700 hover:border-gray-600
              transition-all duration-200
            "
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            className="
              flex-1 px-4 py-2.5 rounded-lg
              bg-purple-600 border border-purple-500
              text-white font-medium
              hover:bg-purple-500
              transition-all duration-200
            "
          >
            批准
          </button>
        </div>

        {/* 提示 */}
        <p className="text-xs text-gray-500 text-center mt-4">
          请仔细检查权限请求后再做决定
        </p>
      </div>
    </div>
  );
}
