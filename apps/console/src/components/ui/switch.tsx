'use client';

import { cx } from './button';

/**
 * A switch for things that run or stop (kill switches): `on` = running. The track carries the state
 * in colour, the knob in position, and the page says it in words beside it, so state never rides on
 * colour alone. Clicking does not flip it by itself: the page opens a confirm and the switch follows
 * the server (`onToggle` only asks).
 */
export function Switch({
  on,
  onToggle,
  label,
  disabled = false,
  size = 'md',
  className,
}: {
  on: boolean;
  onToggle: () => void;
  /** Accessible name: the thing it switches. */
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-pill border transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-5 w-9' : 'h-6 w-11',
        on ? 'border-ok-solid bg-ok-solid' : 'border-bad/60 bg-bad-tint',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-1/2 -translate-y-1/2 rounded-pill transition-[inset-inline-start] duration-fast',
          sm ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]',
          // RTL: running puts the knob at the end edge (left), stopped at the start edge (right).
          on
            ? cx('bg-surface shadow-card', sm ? 'start-[18px]' : 'start-[22px]')
            : 'start-[2px] bg-bad-solid',
        )}
      />
    </button>
  );
}
