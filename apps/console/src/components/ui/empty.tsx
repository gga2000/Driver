import type { ReactNode } from 'react';
import { cx } from './button';
import { IconInbox } from './icons';

/**
 * Empty states say what this is, why it is empty and what to do next. The mark is a quiet line
 * icon in a soft well — no illustration library, no mascot.
 */
export function EmptyState({
  title,
  hint,
  children,
  icon,
  bare = false,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  bare?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center px-6 py-10 text-center',
        !bare && 'rounded-lg border border-dashed border-line bg-surface/60',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-pill bg-surface-3 text-muted"
      >
        {icon ?? <IconInbox size={20} />}
      </span>
      <p className="text-[15px] font-semibold text-text">{title}</p>
      {hint ? <p className="mt-1 max-w-[44ch] text-sm text-muted">{hint}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** A loading bar that shimmers (first load only; refetches keep the data on screen). */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'block animate-shimmer rounded-[6px] bg-surface-3 bg-[length:200%_100%] [background-image:linear-gradient(90deg,transparent_0%,rgb(var(--c-surface)/0.7)_50%,transparent_100%)]',
        className,
      )}
    />
  );
}

/** Kept name: a pulsing block sized by `className`. */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <Skeleton className={cx('rounded-lg', className)} />;
}
