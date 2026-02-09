/**
 * 消息气泡组件
 *
 * 显示单条聊天消息，支持用户/助手/系统消息
 */

import Markdown from 'react-markdown';
import type { ChatMessage } from '../stores/sessionsStore';

/** 消息气泡 Props */
export interface MessageBubbleProps {
  /** 消息数据 */
  message: ChatMessage;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 消息气泡组件
 */
export function MessageBubble({ message, className = '' }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 系统消息样式
  if (isSystem) {
    return (
      <div className={`flex justify-center my-4 ${className}`}>
        <div className="px-4 py-2 rounded-full bg-gray-800 text-gray-400 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`
        flex ${isUser ? 'justify-end' : 'justify-start'} mb-4
        ${className}
      `}
    >
      <div
        className={`
          max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3
          ${
            isUser
              ? 'bg-purple-600 text-white rounded-br-md'
              : 'bg-gray-800 text-gray-100 rounded-bl-md'
          }
        `}
      >
        {/* 消息内容 */}
        <div
          className={`
            prose prose-sm max-w-none
            ${isUser ? 'prose-invert' : 'prose-invert'}
          `}
        >
          {isUser ? (
            // 用户消息不需要 Markdown 渲染
            <p className="m-0 whitespace-pre-wrap">{message.content}</p>
          ) : (
            // 助手消息使用 Markdown 渲染
            <Markdown
              components={{
                // 自定义代码块样式
                pre: ({ children }) => (
                  <pre className="bg-gray-900 rounded-lg p-3 overflow-x-auto my-2">
                    {children}
                  </pre>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code
                      className="bg-gray-900 px-1.5 py-0.5 rounded text-purple-300"
                      {...props}
                    >
                      {children}
                    </code>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                // 链接在新标签页打开
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {children}
                  </a>
                ),
                // 段落样式
                p: ({ children }) => (
                  <p className="my-2 first:mt-0 last:mb-0">{children}</p>
                ),
                // 列表样式
                ul: ({ children }) => (
                  <ul className="my-2 ml-4 list-disc">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-2 ml-4 list-decimal">{children}</ol>
                ),
              }}
            >
              {message.content}
            </Markdown>
          )}
        </div>

        {/* 时间戳 */}
        <div
          className={`
            text-[10px] mt-1 opacity-60
            ${isUser ? 'text-right' : 'text-left'}
          `}
        >
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
