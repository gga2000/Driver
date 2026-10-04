'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Kbd } from './kbd';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-50';

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-dense',
  md: 'h-[var(--ctl-h)] px-3.5 text-sm',
  lg: 'h-11 px-5 text-sm',
};

/** Toggle buttons (aria-pressed) read as selected: a warm wash and ink, never colour alone (weight too). */
const PRESSED =
  'aria-pressed:border-accent/70 aria-pressed:bg-accent-tint aria-pressed:font-semibold aria-pressed:text-text';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent font-semibold text-on-accent shadow-card hover:bg-accent-hover active:translate-y-px',
  secondary: `border border-line bg-surface text-text shadow-card hover:border-line-strong hover:bg-surface-2 ${PRESSED}`,
  ghost: `text-muted hover:bg-surface-2 hover:text-text ${PRESSED}`,
  danger: 'bg-bad-solid font-semibold text-on-bad shadow-card hover:opacity-90',
  'danger-soft': 'border border-line bg-surface text-bad hover:border-bad/50 hover:bg-bad-tint',
};

export function buttonCls(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return cx(BASE, SIZE[size], VARIANT[variant], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** A shortcut hint shown inside the button ("E", "⌘↵"). */
  kbd?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    kbd,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonCls(variant, size, className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {kbd ? <Kbd tone={variant === 'primary' ? 'on-accent' : 'default'}>{kbd}</Kbd> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the accessible name (icon-only). */
  label: string;
  variant?: 'ghost' | 'secondary';
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast disabled:opacity-50',
        size === 'sm' ? 'h-8 w-8' : 'h-[var(--ctl-h)] w-[var(--ctl-h)]',
        variant === 'ghost'
          ? `text-muted hover:bg-surface-2 hover:text-text ${PRESSED}`
          : `border border-line bg-surface text-text shadow-card hover:bg-surface-2 ${PRESSED}`,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cx('h-4 w-4 animate-spin', className)}
      fill="none"
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.2" />
      <path
        d="M17 10a7 7 0 0 0-7-7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Class strings for pages that style plain elements (kept from the first Console kit; now themed).
export const primaryBtn = buttonCls('primary');
export const ghostBtn = buttonCls('secondary');
export const dangerBtn = buttonCls('danger');
export const quietBtn = buttonCls('ghost');
