'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { t, type MessageKey } from '@driver/i18n';
import { useSyncExternalStore, type ComponentType } from 'react';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { isActive, visibleNav, type IconName } from '@/lib/nav';
import { useNavCounts } from '@/lib/nav-counts';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { setSupportView, useSupportView } from '@/lib/support-store';
import { SUPPORT_VIEWS, viewCounts } from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import {
  CountBadge,
  cx,
  IconApprovals,
  IconButton,
  IconCash,
  IconControls,
  IconDispatch,
  IconDrivers,
  IconKeyboard,
  IconMap,
  IconOrders,
  IconPhone,
  IconPricing,
  IconSidebar,
  IconSupport,
  IconSystem,
  IconWall,
  IconSiren,
  IconStore,
  IconZones,
  Kbd,
  type IconProps,
} from '../ui';
import { BrandWordmark } from './brand';

export const NAV_ICONS: Record<IconName, ComponentType<IconProps>> = {
  map: IconMap,
  dispatch: IconDispatch,
  orders: IconOrders,
  drivers: IconDrivers,
  support: IconSupport,
  approvals: IconApprovals,
  cash: IconCash,
  pricing: IconPricing,
  controls: IconControls,
  wall: IconWall,
  zones: IconZones,
  stores: IconStore,
  safety: IconSiren,
  phone: IconPhone,
  system: IconSystem,
};

/**
 * The RTL sidebar on the start (right) edge: the Driver mark, sections grouped by job, live count
 * badges, the support desk's smart views nested under الدعم while you're on it, and a collapse to an
 * icon rail. The selected page is a white tab lifted off the cream, with an orange icon.
 */
export function Sidebar({ onShortcuts }: { onShortcuts: () => void }) {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const userCollapsed = useSidebarCollapsed();
  // The support desk needs its three panes: below 1440 px the sidebar steps back to the icon rail there.
  const narrow = useMedia('(max-width: 1439px)');
  const collapsed =
    userCollapsed || (narrow && (pathname === '/support' || pathname.startsWith('/support/')));
  const { roles, loaded } = useMyRoles();
  const counts = useNavCounts();
  const groups = signedIn ? visibleNav(roles, loaded) : [];
  return (
    <aside
      aria-label={t('app.console')}
      className={cx(
        'sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-e border-line bg-sidebar transition-[width] duration-base ease-standard lg:flex',
        collapsed ? 'w-[68px]' : 'w-[var(--sidebar-w)]',
      )}
    >
      <div
        className={cx(
          'flex h-14 items-center gap-2 px-4',
          collapsed ? 'justify-center px-0' : 'justify-between',
        )}
      >
        <Link href="/" className="rounded-md" aria-label={t('console.brand')}>
          <BrandWordmark compact={collapsed} />
        </Link>
        {collapsed ? null : (
          <IconButton
            label={t('console.sidebar_collapse')}
            size="sm"
            onClick={() => setSidebarCollapsed(true)}
          >
            <IconSidebar size={17} />
          </IconButton>
        )}
      </div>

      <nav aria-label={t('app.console')} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {groups.map((g) => (
          <div key={g.key} className="mb-4">
            {collapsed ? (
              <div aria-hidden className="mx-3 mb-2 border-t border-line" />
            ) : (
              <p className="mb-1 px-3 text-xs font-medium text-faint">{t(g.key)}</p>
            )}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = NAV_ICONS[item.icon];
                const c = counts[item.href as keyof typeof counts];
                const badgeLabel =
                  c && c.n > 0
                    ? t(`console.nav_badge_${item.href.slice(1)}` as MessageKey, { n: c.n })
                    : undefined;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={
                        collapsed
                          ? `${t(item.key)}${badgeLabel ? ` · ${badgeLabel}` : ''}`
                          : badgeLabel
                      }
                      className={cx(
                        'group relative flex h-9 items-center gap-3 rounded-md text-sm transition-colors duration-fast',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        active
                          ? 'bg-surface font-semibold text-text shadow-card'
                          : 'text-muted hover:bg-surface/70 hover:text-text',
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-2 start-0 w-[3px] rounded-pill bg-accent"
                        />
                      ) : null}
                      <Icon
                        size={18}
                        className={cx(
                          'shrink-0',
                          active ? 'text-accent-text' : 'text-muted group-hover:text-text',
                        )}
                      />
                      {collapsed ? (
                        c && c.n > 0 ? (
                          <span
                            aria-hidden
                            className={cx(
                              'absolute end-2 top-1.5 h-2 w-2 rounded-pill',
                              c.alert ? 'bg-bad-solid' : 'bg-accent',
                            )}
                          />
                        ) : null
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                          {c ? <CountBadge n={c.n} alert={c.alert} /> : null}
                        </>
                      )}
                    </Link>
                    {item.href === '/support' && active && !collapsed ? <SupportViewsNav /> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={cx('border-t border-line p-3', collapsed && 'flex flex-col items-center gap-1')}
      >
        {collapsed ? (
          <>
            <IconButton
              label={t('console.sidebar_expand')}
              size="sm"
              onClick={() => setSidebarCollapsed(false)}
            >
              <IconSidebar size={17} className="-scale-x-100" />
            </IconButton>
            <IconButton label={t('console.shortcuts_open')} size="sm" onClick={onShortcuts}>
              <IconKeyboard size={17} />
            </IconButton>
          </>
        ) : (
          <button
            type="button"
            onClick={onShortcuts}
            className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors hover:bg-surface/70 hover:text-text"
          >
            <IconKeyboard size={18} />
            <span className="flex-1 text-start">{t('console.shortcuts')}</span>
            <Kbd>?</Kbd>
          </button>
        )}
      </div>
    </aside>
  );
}

/** الدعم's smart views, nested in the sidebar while the desk is open. */
function SupportViewsNav() {
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
                  : 'text-muted hover:bg-surface/70 hover:text-text',
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

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
