import type { ReactNode } from 'react';

/** A key cap: "J", "⌘K", "Ctrl ↵". LTR so key combos read in typing order. */
export function Kbd({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode;
  tone?: 'default' | 'on-accent' | 'inverse';
  className?: string;
}) {
  const toneCls =
    tone === 'on-accent'
      ? 'border-on-accent/25 bg-on-accent/10 text-on-accent'
      : tone === 'inverse'
        ? 'border-on-inverse/25 bg-on-inverse/10 text-on-inverse'
        : 'border-line bg-surface-2 text-muted shadow-[inset_0_-1px_0_rgb(var(--c-line))]';
  return (
    <kbd
      dir="ltr"
      className={`inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-[5px] border px-1 font-sans text-[11px] font-medium leading-none ${toneCls} ${className}`}
    >
      {children}
    </kbd>
  );
}

/** Label + keys, for menus and the shortcut sheet. */
export function KeyboardHint({ keys, label }: { keys: string[]; label?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      {label}
      <span className="inline-flex items-center gap-0.5">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </span>
  );
}
