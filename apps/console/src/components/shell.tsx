'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import type { ReactNode } from 'react';
import { NAV } from '@/lib/nav';
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
          <ApiStatus />
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
