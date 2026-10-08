'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t, type MessageKey } from '@driver/i18n';
import { useSyncExternalStore, type ComponentType } from 'react';
import { useMyRoles } from '@/lib/me';
import { isActive, visibleNav, type IconName, type NavGroup } from '@/lib/nav';
import { useNavCounts } from '@/lib/nav-counts';
import { setNavSettingsOpen, setSidebarCollapsed, useNavSettingsOpen, useSidebarCollapsed } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import {
  cx,
  IconApprovals,
  IconButton,
  IconCash,
  IconChevronDown,
  IconControls,
  IconDispatch,
  IconDrivers,
  IconKeyboard,
  IconMap,
  IconOrders,
  IconPhone,
  IconBell,
  IconInbox,
  IconPricing,
  IconSidebar,
  IconSupport,
  IconSystem,
  IconWall,
  IconSiren,
  IconStore,
  IconChat,
  IconZones,
  Kbd,
  type IconProps,
} from '../ui';
import { BrandWordmark } from './brand';

// Only drawn on the support desk, so it loads there instead of with every page (speed budget).
const SupportViewsNav = dynamic(() => import('./support-views-nav').then((m) => m.SupportViewsNav), {
  ssr: false,
});

export const NAV_ICONS: Record<IconName, ComponentType<IconProps>> = {
  today: IconInbox,
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
  reviews: IconChat,
  safety: IconSiren,
  phone: IconPhone,
  oncall: IconBell,
  system: IconSystem,
};

/**
 * The RTL sidebar on the start (right) edge: the Driver mark, sections grouped by job, live count
 * badges, the support desk's smart views nested under الدعم while you're on it, and a collapse to an
 * icon rail. It is the date-brown island (`data-ink="date"`, CON-11): cream ink on the dark of a dried
 * date in both themes, the selected page a lighter date tab with a saffron bar.
 *
 * Organized (Ali 2026-10-08): groups by tempo with one quiet heading each, the settings folded under
 * their heading, counts as plain numbers beside the name and red only when something is overdue, and
 * the collapse and shortcuts buttons together at the foot.
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
      data-ink="date"
      className={cx(
        'sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-e border-line bg-sidebar text-text transition-[width] duration-base ease-standard lg:flex',
        collapsed ? 'w-[68px]' : 'w-[var(--sidebar-w)]',
      )}
    >
      <div className={cx('flex h-14 shrink-0 items-center px-5', collapsed && 'justify-center px-0')}>
        <Link href="/" className="rounded-md" aria-label={t('console.brand')}>
          <BrandWordmark compact={collapsed} />
        </Link>
      </div>

      <nav aria-label={t('app.console')} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((g, i) => (
          <NavSection
            key={g.key ?? 'top'}
            group={g}
            first={i === 0}
            pathname={pathname}
            collapsed={collapsed}
            counts={counts}
          />
        ))}
      </nav>

      <div
        className={cx(
          'flex shrink-0 items-center gap-1 border-t border-line p-3',
          collapsed && 'flex-col',
        )}
      >
        {collapsed ? (
          <IconButton label={t('console.shortcuts_open')} size="sm" onClick={onShortcuts}>
            <IconKeyboard size={17} />
          </IconButton>
        ) : (
          <button
            type="button"
            onClick={onShortcuts}
            className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <IconKeyboard size={18} className="shrink-0" />
            <span className="flex-1 truncate text-start">{t('console.shortcuts')}</span>
            <Kbd>?</Kbd>
          </button>
        )}
        <IconButton
          label={t(collapsed ? 'console.sidebar_expand' : 'console.sidebar_collapse')}
          size="sm"
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          <IconSidebar size={17} className={collapsed ? '-scale-x-100' : undefined} />
        </IconButton>
      </div>
    </aside>
  );
}

type Counts = ReturnType<typeof useNavCounts>;

/** One group: a quiet heading (none for the top group), or a fold button for the settings. */
function NavSection({
  group,
  first,
  pathname,
  collapsed,
  counts,
}: {
  group: NavGroup;
  first: boolean;
  pathname: string;
  collapsed: boolean;
  counts: Counts;
}) {
  const stored = useNavSettingsOpen();
  const holdsActive = group.items.some((i) => isActive(pathname, i.href));
  // A folded group opens itself while you're on one of its pages; the rail always shows every icon.
  const open = !group.folded || collapsed || stored || holdsActive;
  const listId = `nav-${group.key ?? 'top'}`;
  return (
    <div className={first ? 'pt-1' : 'pt-4'}>
      {collapsed ? (
        first ? null : <div aria-hidden className="mx-3 mb-3 border-t border-line" />
      ) : group.folded ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          disabled={holdsActive}
          onClick={() => {
            setNavSettingsOpen(!stored);
            // Opening it at the foot of a short screen: bring the pages into view.
            if (!stored)
              requestAnimationFrame(() =>
                document.getElementById(listId)?.lastElementChild?.scrollIntoView({ block: 'nearest' }),
              );
          }}
          className="mb-0.5 flex h-6 w-full items-center gap-2 rounded-md px-3 text-[11px] font-medium tracking-[0.02em] text-faint transition-colors hover:text-text disabled:hover:text-faint"
        >
          <span className="flex-1 text-start">{t(group.key!)}</span>
          {open ? null : <span className="num">{group.items.length}</span>}
          <IconChevronDown
            size={14}
            className={cx('transition-transform duration-fast', open && 'rotate-180')}
          />
        </button>
      ) : group.key ? (
        <p className="mb-0.5 flex h-6 items-center px-3 text-[11px] font-medium tracking-[0.02em] text-faint">
          {t(group.key)}
        </p>
      ) : null}
      {open ? (
        <ul id={listId} className="space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={collapsed}
              count={counts[item.href as keyof Counts]}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  count: c,
}: {
  item: NavGroup['items'][number];
  active: boolean;
  collapsed: boolean;
  count: { n: number; alert: boolean } | undefined;
}) {
  const Icon = NAV_ICONS[item.icon];
  const badgeLabel =
    c && c.n > 0 ? t(`console.nav_badge_${item.href.slice(1)}` as MessageKey, { n: c.n }) : undefined;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? `${t(item.key)}${badgeLabel ? ` · ${badgeLabel}` : ''}` : badgeLabel}
        className={cx(
          'group relative flex h-8 items-center gap-3 rounded-md text-sm transition-colors duration-fast',
          collapsed ? 'justify-center px-0' : 'px-3',
          active ? 'bg-accent-tint font-semibold text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
        )}
      >
        {active ? (
          <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-pill bg-accent" />
        ) : null}
        <Icon
          size={18}
          className={cx('shrink-0', active ? 'text-accent' : 'text-muted group-hover:text-text')}
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
            <span className="min-w-0 truncate">{t(item.key)}</span>
            {c && c.n > 0 ? <NavCount n={c.n} alert={c.alert} /> : null}
          </>
        )}
      </Link>
      {item.href === '/support' && active && !collapsed ? <SupportViewsNav /> : null}
    </li>
  );
}

/** A plain number at the row's end; a red pill only when something is overdue. */
function NavCount({ n, alert }: { n: number; alert: boolean }) {
  return (
    <span
      className={cx(
        'num ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-pill text-xs leading-none',
        alert ? 'bg-bad-solid px-1.5 font-semibold text-on-bad' : 'text-faint',
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
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
