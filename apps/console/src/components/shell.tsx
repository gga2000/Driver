'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import type { ReactNode } from 'react';
import { NAV } from '@/lib/nav';
import { clearSession, getSession, useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';

/**
 * RTL console shell: sidebar on the start (right) side at ≥ 1024 px, a horizontal tab strip under the
 * header on phones. Nav labels come from i18n so the brand swap and locale swap stay data changes.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-e lg:border-b-0 border-b">
        <div className="flex items-center justify-between px-5 py-4 lg:block">
          <Link href="/" className="rounded-md font-display text-lg font-bold">
            <span className="text-accent">●</span> {t('app.console')}
          </Link>
          <div className="flex items-center gap-4 lg:block">
            <ApiStatus />
            <span className="lg:hidden">
              <SessionControl />
            </span>
          </div>
        </div>
        <nav aria-label={t('app.console')} className="overflow-x-auto px-3 pb-3 lg:px-3">
          <ul className="flex gap-1 lg:flex-col">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-surface-2 font-semibold text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'
                    }`}
                  >
                    {t(item.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="hidden px-5 pb-4 lg:block">
          <SessionControl />
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}

function ApiStatus() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions(undefined, { refetchInterval: 10_000 }));
  const label = health.isPending ? t('console.api_checking') : health.isSuccess ? t('console.api_online') : t('console.api_offline');
  const dot = health.isPending ? 'bg-muted' : health.isSuccess ? 'bg-ok' : 'bg-bad';
  return (
    <p className="mt-0 flex items-center gap-2 text-xs text-muted lg:mt-2" role="status">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-pill ${dot}`} />
      {label}
      {health.data?.version && <span className="font-mono">v{health.data.version}</span>}
    </p>
  );
}

function SessionControl() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const logout = useMutation(trpc.identity.logout.mutationOptions());
  if (!signedIn) {
    return (
      <Link href="/login" className="rounded-md text-sm text-accent underline">
        {t('console.login')}
      </Link>
    );
  }
  const signOut = () => {
    const refreshToken = getSession()?.refreshToken;
    // Best-effort server revoke first (the batch link reads the bearer token when it sends),
    // then the local session is cleared whatever the outcome.
    logout.mutate(refreshToken ? { refreshToken } : {}, {
      onSettled: () => {
        clearSession();
        queryClient.clear();
      },
    });
  };
  return (
    <span className="flex items-center gap-3 text-xs text-muted">
      <span className="hidden lg:inline">{t('console.login_signed_in')}</span>
      <button type="button" onClick={signOut} disabled={logout.isPending} className="rounded-md text-sm text-text underline hover:text-accent">
        {t('console.logout')}
      </button>
    </span>
  );
}
