/**
 * 终端视图组件
 *
 * 使用 xterm.js 渲染终端界面
 */

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useSessionsStore } from '../stores/sessionsStore';

/** 终端视图 Props */
export interface TerminalViewProps {
  /** 会话 ID */
  sessionId: string;
  /** 发送输入回调 */
  onInput: (data: string) => void;
  /** 终端尺寸变化回调 */
  onResize?: (cols: number, rows: number) => void;
  /** 是否禁用输入 */
  disabled?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 终端视图组件
 */
export function TerminalView({
  sessionId,
  onInput,
  onResize,
  disabled = false,
  className = '',
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastBufferLengthRef = useRef(0);

  // 获取终端缓冲区
  const terminalBuffer = useSessionsStore(
    (state) => state.sessions.find((s) => s.id === sessionId)?.terminalBuffer ?? ''
  );

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    // 创建终端实例
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
        selectionBackground: '#3392FF44',
      },
      allowTransparency: true,
      scrollback: 10000,
    });

    // 创建 FitAddon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // 挂载到 DOM
    terminal.open(containerRef.current);
    fitAddon.fit();

    // 保存引用
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // 处理用户输入
    terminal.onData((data) => {
      if (!disabled) {
        onInput(data);
      }
    });

    // 初始通知尺寸
    if (onResize) {
      onResize(terminal.cols, terminal.rows);
    }

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [disabled, onInput, onResize]);

  // 处理窗口尺寸变化
  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit();
      if (onResize) {
        onResize(terminalRef.current.cols, terminalRef.current.rows);
      }
    }
  }, [onResize]);

  // 监听窗口尺寸变化
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // 使用 ResizeObserver 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [handleResize]);

  // 写入新的终端输出
  useEffect(() => {
    if (!terminalRef.current) return;

    // 只写入新增的内容
    if (terminalBuffer.length > lastBufferLengthRef.current) {
      const newContent = terminalBuffer.slice(lastBufferLengthRef.current);
      terminalRef.current.write(newContent);
      lastBufferLengthRef.current = terminalBuffer.length;
    }
  }, [terminalBuffer]);

  return (
    <div
      ref={containerRef}
      className={`
        w-full h-full bg-[#0d1117] rounded-lg overflow-hidden
        ${disabled ? 'opacity-60' : ''}
        ${className}
      `}
    />
  );
}
