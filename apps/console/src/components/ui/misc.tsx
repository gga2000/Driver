import { useId, type ReactNode } from 'react';
import { cx } from './button';

/**
 * Tooltip: on hover and keyboard focus, after a short delay; text only, never the only place a
 * fact lives. Avatar: one initial on a tint picked from the id (stable per person). Timeline: what
 * happened, oldest first, the current step marked.
 */

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex" aria-describedby={id}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cx(
          'pointer-events-none absolute start-1/2 z-50 w-max max-w-64 rounded-md bg-inverse px-2 py-1 text-xs text-on-inverse opacity-0 shadow-pop transition-opacity delay-300 duration-fast rtl:translate-x-1/2 group-focus-within/tt:opacity-100 group-hover/tt:opacity-100 ltr:-translate-x-1/2',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  );
}

const AVATAR_TONES = [
  'bg-accent-tint text-accent-text',
  'bg-info-tint text-info',
  'bg-ok-tint text-ok',
  'bg-warn-tint text-warn',
  'bg-surface-3 text-muted',
] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The first letter of the first word (Arabic initials don't join into a readable pair). */
export function initialOf(name: string | null | undefined): string {
  const w = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return w ? Array.from(w)[0]! : '؟';
}

export function Avatar({
  name,
  id,
  size = 'md',
  className,
}: {
  name: string | null | undefined;
  id: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tone = AVATAR_TONES[hash(id) % AVATAR_TONES.length];
  const s =
    size === 'sm' ? 'h-6 w-6 text-xs' : size === 'lg' ? 'h-11 w-11 text-lg' : 'h-8 w-8 text-sm';
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-pill font-semibold',
        s,
        tone,
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}

export interface TimelineItem {
  id: string;
  title: ReactNode;
  time?: ReactNode;
  meta?: ReactNode;
  tone?: 'default' | 'ok' | 'bad' | 'accent';
  current?: boolean;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cx('relative', className)}>
      {items.map((it, i) => {
        const dot =
          it.tone === 'ok'
            ? 'bg-ok-solid'
            : it.tone === 'bad'
              ? 'bg-bad-solid'
              : it.tone === 'accent' || it.current
                ? 'bg-accent'
                : 'bg-line-strong';
        return (
          <li key={it.id} className="relative flex gap-3 pb-3 last:pb-0">
            {i < items.length - 1 ? (
              <span
                aria-hidden
                className="absolute start-[5px] top-4 h-[calc(100%-8px)] w-px bg-line"
              />
            ) : null}
            <span
              aria-hidden
              className={cx(
                'relative mt-[7px] h-[11px] w-[11px] shrink-0 rounded-pill ring-4 ring-surface',
                dot,
              )}
            >
              {it.current ? (
                <span className="absolute inset-0 animate-ping rounded-pill bg-accent opacity-40" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cx('text-sm', it.current ? 'font-semibold text-text' : 'text-text')}>
                  {it.title}
                </p>
                {it.time ? (
                  <span className="num shrink-0 text-xs text-faint">{it.time}</span>
                ) : null}
              </div>
              {it.meta ? <div className="text-xs text-muted">{it.meta}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
