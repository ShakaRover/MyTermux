/**
 * Claude 对话视图组件
 *
 * 显示 Claude 对话界面，包含消息列表和输入框
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageBubble } from './MessageBubble';
import { useSessionsStore } from '../stores/sessionsStore';

/** 对话视图 Props */
export interface ChatViewProps {
  /** 会话 ID */
  sessionId: string;
  /** 发送消息回调 */
  onSendMessage: (content: string) => void;
  /** 是否禁用输入 */
  disabled?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * Claude 对话视图组件
 */
export function ChatView({
  sessionId,
  onSendMessage,
  disabled = false,
  className = '',
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 获取会话消息
  const session = useSessionsStore((state) =>
    state.sessions.find((s) => s.id === sessionId)
  );
  const messages = session?.messages ?? [];

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 自动调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // 发送消息
  const handleSend = useCallback(() => {
    const trimmedInput = input.trim();
    if (!trimmedInput || disabled) return;

    onSendMessage(trimmedInput);
    setInput('');

    // 重置输入框高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, disabled, onSendMessage]);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 按 Enter 发送（Shift+Enter 换行）
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [isComposing, handleSend]
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg
              className="w-16 h-16 mb-4 opacity-30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-lg font-medium">开始对话</p>
            <p className="text-sm mt-1">在下方输入框输入消息开始与 Claude 对话</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-gray-800 p-4 bg-gray-900/50">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder={disabled ? '等待连接...' : '输入消息... (Enter 发送, Shift+Enter 换行)'}
              disabled={disabled}
              rows={1}
              className={`
                w-full px-4 py-3 rounded-xl
                bg-gray-800 border border-gray-700
                text-gray-100 placeholder-gray-500
                resize-none overflow-hidden
                focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              `}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            className={`
              flex-shrink-0 p-3 rounded-xl
              bg-purple-600 text-white
              hover:bg-purple-500
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-purple-600
              transition-all duration-200
            `}
            title="发送消息"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
