'use client';

import { useQuery } from '@tanstack/react-query';
import { t, type MessageKey } from '@driver/i18n';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { setSupportView, useSupportView } from '@/lib/support-store';
import { SUPPORT_VIEWS, viewCounts } from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import { cx } from '../ui';

/** الدعم's smart views, nested in the sidebar while the desk is open. */
export function SupportViewsNav() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { personId } = useMyRoles();
  const view = useSupportView();
  const list = useQuery(
    trpc.support.list.queryOptions(
      { cityId: CITY_ID, status: 'active' },
      { enabled: signedIn, refetchInterval: 15_000, retry: queryRetry },
    ),
  );
  const counts = list.data ? viewCounts(list.data.rows, personId) : null;
  return (
    <ul
      aria-label={t('console.sup_views')}
      className="relative my-1 ms-[21px] space-y-px border-s border-line ps-2"
    >
      {SUPPORT_VIEWS.map((v) => {
        const on = v === view;
        const n = counts?.[v] ?? 0;
        return (
          <li key={v}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => setSupportView(v)}
              className={cx(
                'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-dense transition-colors',
                on
                  ? 'bg-accent-tint font-semibold text-text'
                  : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <span className="flex-1 truncate text-start">
                {t(`console.sup_view_${v}` as MessageKey)}
              </span>
              {v !== 'resolved' && n > 0 ? (
                <span
                  className={cx(
                    'num text-xs',
                    v === 'breached'
                      ? 'font-semibold text-bad'
                      : on
                        ? 'text-accent-text'
                        : 'text-faint',
                  )}
                >
                  {n}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
