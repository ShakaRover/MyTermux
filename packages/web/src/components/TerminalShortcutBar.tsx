import type { WebShortcut } from '@mytermux/shared';

export interface TerminalShortcutBarProps {
  visible: boolean;
  shortcuts: WebShortcut[];
  commonChars: string[];
  onSend: (value: string) => void;
  className?: string;
}

export function TerminalShortcutBar({
  visible,
  shortcuts,
  commonChars,
  onSend,
  className = '',
}: TerminalShortcutBarProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className={`
        border-t border-gray-700 bg-gray-900/95 px-3 py-2
        backdrop-blur supports-[backdrop-filter]:bg-gray-900/80
        ${className}
      `}
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.id}
            onClick={() => onSend(shortcut.value)}
            className="shrink-0 rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-100"
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {commonChars.map((item) => (
          <button
            key={item}
            onClick={() => onSend(item)}
            className="shrink-0 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
