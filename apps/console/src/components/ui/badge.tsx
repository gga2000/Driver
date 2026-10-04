import type { ReactNode } from 'react';
import { cx } from './button';

/**
 * Status chips. Tone carries meaning, but never alone: every chip has words, and `dot` adds a
 * shape. `neutral` waits, `live` is moving, `ready` needs a person, `done` finished well, `warn`
 * is getting late, `bad` is a problem, `accent` is the one selected thing.
 */
export type ChipTone = 'neutral' | 'live' | 'ready' | 'done' | 'bad' | 'warn' | 'accent';

const TONE: Record<ChipTone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-surface-3 text-muted', dot: 'bg-muted' },
  live: { chip: 'bg-info-tint text-info', dot: 'bg-info-solid' },
  ready: { chip: 'bg-accent-tint text-accent-text', dot: 'bg-accent' },
  done: { chip: 'bg-ok-tint text-ok', dot: 'bg-ok-solid' },
  bad: { chip: 'bg-bad-tint text-bad', dot: 'bg-bad-solid' },
  warn: { chip: 'bg-warn-tint text-warn', dot: 'bg-warn-solid' },
  accent: { chip: 'bg-accent text-on-accent', dot: 'bg-on-accent' },
};

export function toneDot(tone: ChipTone): string {
  return TONE[tone].dot;
}

export function Chip({
  tone = 'neutral',
  children,
  title,
  dot = false,
  size = 'md',
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill font-medium',
        size === 'sm' ? 'h-5 px-1.5 text-[11px] leading-5' : 'h-6 px-2 text-xs',
        TONE[tone].chip,
        className,
      )}
    >
      {dot ? (
        <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-pill', TONE[tone].dot)} />
      ) : null}
      {children}
    </span>
  );
}

/** Same thing, the name the design system uses. */
export const Badge = Chip;

/** A count bubble for nav items and tabs ("4"). `alert` turns it red-tinted. */
export function CountBadge({
  n,
  alert = false,
  className,
}: {
  n: number;
  alert?: boolean;
  className?: string;
}) {
  if (n <= 0) return null;
  return (
    <span
      className={cx(
        'num inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-[11px] font-semibold leading-none',
        alert ? 'bg-bad-solid text-on-bad' : 'bg-surface-3 text-muted',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** A live/idle/down dot with an optional pulse ring (the only ambient motion in the Console). */
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  pulse?: boolean;
  className?: string;
}) {
  const color =
    tone === 'ok'
      ? 'bg-ok-solid'
      : tone === 'warn'
        ? 'bg-warn-solid'
        : tone === 'bad'
          ? 'bg-bad-solid'
          : 'bg-faint';
  return (
    <span aria-hidden className={cx('relative inline-flex h-2 w-2 shrink-0', className)}>
      {pulse ? (
        <span className={cx('absolute inset-0 animate-ping rounded-pill opacity-40', color)} />
      ) : null}
      <span className={cx('relative inline-flex h-2 w-2 rounded-pill', color)} />
    </span>
  );
}
