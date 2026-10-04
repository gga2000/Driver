import type { ReactNode } from 'react';
import { cx } from './button';

/**
 * Page and section structure. Hierarchy comes from type and rules, not boxes: a page has one
 * title; sections inside a card are separated by a hairline, not by more cards.
 */

export function PageHeader({
  title,
  subtitle,
  children,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-dense text-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold tracking-[-0.01em] text-text">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-[68ch] text-sm text-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  hint,
  actions,
  count,
  as: As = 'h2',
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  count?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="min-w-0">
        <As className="flex items-center gap-2 text-[15px] font-semibold leading-6 text-text">
          {title}
          {count !== undefined && count !== null ? (
            <span className="num text-dense font-medium text-muted">{count}</span>
          ) : null}
        </As>
        {hint ? <p className="text-dense text-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
  actions,
  tone = 'default',
  hint,
  flush = false,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  tone?: 'default' | 'bad' | 'ok' | 'warn';
  hint?: ReactNode;
  /** No inner padding (tables, lists that run to the edge). */
  flush?: boolean;
}) {
  const edge =
    tone === 'bad'
      ? 'border-bad/45'
      : tone === 'ok'
        ? 'border-ok/45'
        : tone === 'warn'
          ? 'border-warn/45'
          : 'border-line';
  return (
    <section
      className={cx(
        'rounded-lg border bg-surface shadow-card',
        edge,
        flush ? '' : 'p-5',
        className,
      )}
    >
      {(title || actions) && (
        <SectionHeader
          title={title}
          hint={hint}
          actions={actions}
          className={cx('mb-4', flush && 'px-5 pt-4')}
        />
      )}
      {children}
    </section>
  );
}

/** A definition row for drawers and detail cards. */
export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-end">{v}</dd>
    </div>
  );
}

/** An id that stays left-to-right inside Arabic text (tabular sans, not a monospace "data" face). */
export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <bdi dir="ltr" title={title} className="num text-xs text-muted">
      {children}
    </bdi>
  );
}

/** A hairline between sections inside one card. */
export function Divider({ className = '' }: { className?: string }) {
  return <hr className={cx('my-4 border-0 border-t border-line', className)} />;
}
