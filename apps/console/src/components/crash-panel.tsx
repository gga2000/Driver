'use client';

import { t } from '@driver/i18n';
import { useEffect } from 'react';
import { crashReporter, startCrashReports } from '@/lib/crash';
import { buttonCls } from './ui/button';
import { EmptyState } from './ui/empty';
import { IconAlert } from './ui/icons';

/** Hooks the window's unhandled errors into the crash reports (a no-op without a DSN). */
export function CrashReporting() {
  useEffect(() => startCrashReports(), []);
  return null;
}

/**
 * What `error.tsx` and `global-error.tsx` show: the page broke, nothing was lost, try again (re-renders
 * the segment) or reload. The error is reported once, scrubbed.
 */
export function CrashPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    crashReporter.capture(error, { logger: 'boundary', handled: false, extra: error.digest ? { digest: error.digest } : undefined });
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-16">
      <EmptyState title={t('console.crash_title')} hint={t('console.crash_body')} icon={<IconAlert size={20} className="text-bad" />}>
        <button type="button" onClick={reset} className={buttonCls('primary')}>
          {t('console.crash_retry')}
        </button>
        <button type="button" onClick={() => window.location.reload()} className={buttonCls('secondary')}>
          {t('console.crash_reload')}
        </button>
      </EmptyState>
    </div>
  );
}
