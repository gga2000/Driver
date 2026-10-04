'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './button';

/**
 * Segmented: 2–5 mutually exclusive options in a sunken track (filters, modes). Tabs: switch the
 * content below (an underline marks the current one). Both are radio-like for keyboards: arrow keys
 * move, Home/End jump. In RTL the right arrow goes to the previous option.
 */

export interface Option<V extends string> {
  value: V;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

function useArrowKeys<V extends string>(options: Option<V>[], value: V, onChange: (v: V) => void) {
  return (e: KeyboardEvent) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowLeft') next = Math.min(enabled.length - 1, i + 1);
    else if (e.key === 'ArrowRight') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next >= 0 && enabled[next]) {
      e.preventDefault();
      onChange(enabled[next]!.value);
    }
  };
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const onKey = useArrowKeys(options, value, onChange);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={cx('inline-flex items-center gap-0.5 rounded-md bg-surface-3 p-0.5', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 font-medium transition-colors duration-fast disabled:opacity-40',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-dense',
              on ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text',
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className={cx('num text-xs', on ? 'text-accent-text' : 'text-faint')}>
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  className?: string;
}) {
  const onKey = useArrowKeys(options, value, onChange);
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className={cx('flex items-center gap-5 border-b border-line', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              '-mb-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm transition-colors duration-fast disabled:opacity-40',
              on
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className="num rounded-pill bg-surface-3 px-1.5 text-xs text-muted">
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
