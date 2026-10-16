'use client';

import { t } from '@driver/i18n';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { crashReporter } from '@/lib/crash';
import { buttonCls } from './button';
import { IconAlert } from './icons';

/**
 * The per-section error: when one card or pane throws while drawing, only that part shows this
 * strip and the rest of the page keeps working. "جرّب مرة ثانية" draws it again. A whole page that
 * throws is `app/error.tsx` (the crash panel); wrap a section in `SectionBoundary` when the page is
 * worth keeping without it (a dashboard tile, a side pane).
 */
export function SectionError({ title, onRetry }: { title?: ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bad/30 bg-bad-tint px-4 py-3 text-sm text-text"
    >
      <p className="flex items-center gap-2">
        <IconAlert size={18} className="shrink-0 text-bad" />
        {title ?? t('console.section_crashed')}
      </p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={buttonCls('secondary', 'sm')}>
          {t('console.retry')}
        </button>
      ) : null}
    </div>
  );
}

export class SectionBoundary extends Component<
  { children: ReactNode; name?: string; fallback?: (retry: () => void) => ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Scrubbed and sent with the page crash reports (a no-op until NEXT_PUBLIC_SENTRY_DSN is set).
    crashReporter.capture(error, { logger: 'section', handled: true, extra: { section: this.props.name ?? '?', stack: info.componentStack ?? '' } });
  }

  retry = () => this.setState({ failed: false });

  override render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.retry) : <SectionError onRetry={this.retry} />;
  }
}
