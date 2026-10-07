'use client';

import { t } from '@driver/i18n';
import { useEffect } from 'react';
import { SectionError } from '@/components/ui';

/** A page that throws while drawing: the shell and sidebar stay, the page says so and can retry. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[console] page failed', error);
  }, [error]);
  return <SectionError title={t('console.page_crashed')} onRetry={reset} />;
}
