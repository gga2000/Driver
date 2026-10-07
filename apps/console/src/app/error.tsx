'use client';

import { CrashPanel } from '@/components/crash-panel';

/** A page that throws while rendering: the shell stays, the page body says so with a retry. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashPanel error={error} reset={reset} />;
}
