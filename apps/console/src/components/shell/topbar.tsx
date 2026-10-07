'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleKind } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useState } from 'react';
import { formatClock } from '@/lib/format';
import { modLabel } from '@/lib/hotkeys';
import { useMyRoles } from '@/lib/me';
import { isActive, visibleNav } from '@/lib/nav';
import { setDensity, setTheme, useDensity, useTheme } from '@/lib/prefs';
import { clearSession, getSession, useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import {
  Avatar,
  buttonCls,
  cx,
  IconButton,
  IconDensity,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSun,
  Kbd,
  Popover,
  StatusDot,
} from '../ui';
import { BrandMark } from './brand';
import { NAV_ICONS } from './sidebar';

const ROLE_ORDER: readonly RoleKind[] = ['admin', 'dispatcher', 'support', 'finance', 'field_ops'];

/** The person's headline role ("مدير", "موزّع"…), the most senior one they hold. */
export function headlineRole(roles: ReadonlySet<RoleKind>): RoleKind | null {
  return ROLE_ORDER.find((r) => roles.has(r)) ?? null;
}

/**
 * The slim top bar: global search (opens the palette, ⌘K / Ctrl+K), the live connection to the
 * API, density and theme, and who is signed in. On phones it also carries the page strip.
 */
export function TopBar({ onSearch }: { onSearch: () => void }) {
  const signedIn = useSignedIn();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <span className="lg:hidden">
          <BrandMark size={28} />
        </span>
        <button
          type="button"
          onClick={onSearch}
          className="group flex h-9 w-full max-w-[460px] items-center gap-2.5 rounded-pill border border-line bg-surface px-3.5 text-start text-sm text-faint transition-colors hover:border-line-strong"
        >
          <IconSearch size={17} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{t('console.search_open')}</span>
          <span dir="ltr" className="hidden items-center gap-0.5 sm:inline-flex">
            <Kbd>{modLabel()}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <ApiStatus />
        <div className="ms-auto flex items-center gap-1.5">
          <Clock />
          <ViewToggles />
          {signedIn ? (
            <Account />
          ) : (
            <Link href="/login" className={buttonCls('primary', 'sm')}>
              {t('console.login')}
            </Link>
          )}
        </div>
      </div>
      <MobileNav />
    </header>
  );
}

function ApiStatus() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions(undefined, { refetchInterval: 10_000 }));
  const tone = health.isPending ? 'idle' : health.isSuccess ? 'ok' : 'bad';
  const label = health.isPending
    ? t('console.api_checking')
    : health.isSuccess
      ? t('console.api_online_short')
      : t('console.api_offline_short');
  return (
    <p
      role="status"
      title={health.data?.version ? `API v${health.data.version}` : undefined}
      className={cx(
        'hidden h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-3 text-xs font-medium sm:inline-flex',
        tone === 'bad' ? 'bg-bad-tint font-semibold text-bad' : 'bg-surface-3 text-muted',
      )}
    >
      <StatusDot tone={tone} pulse={tone === 'ok'} />
      {label}
    </p>
  );
}

/** The city clock, so a night-shift agent and the server agree on "now" (Baghdad time, Western digits). */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <p
      title={t('console.clock_baghdad')}
      className="num me-1 hidden h-8 shrink-0 items-center rounded-pill bg-surface-3 px-3 text-xs font-semibold text-text md:inline-flex"
    >
      <span className="sr-only">{t('console.clock_baghdad')} </span>
      {formatClock(now)}
    </p>
  );
}

function ViewToggles() {
  const theme = useTheme();
  const density = useDensity();
  return (
    <>
      <IconButton
        label={
          density === 'compact' ? t('console.density_comfortable') : t('console.density_compact')
        }
        aria-pressed={density === 'compact'}
        onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
      >
        <IconDensity size={18} />
      </IconButton>
      <IconButton
        label={theme === 'dark' ? t('console.theme_light') : t('console.theme_dark')}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </IconButton>
    </>
  );
}

function Account() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const me = useQuery(
    trpc.identity.me.queryOptions(undefined, { staleTime: 60_000, retry: false }),
  );
  const { roles } = useMyRoles();
  const [open, setOpen] = useState(false);
  const logout = useMutation(trpc.identity.logout.mutationOptions());
  const role = headlineRole(roles);
  const name = me.data?.name ?? t('console.staff_unknown');
  const signOut = () => {
    const refreshToken = getSession()?.refreshToken;
    // Best-effort server revoke first, then the local session is cleared whatever the outcome.
    logout.mutate(refreshToken ? { refreshToken } : {}, {
      onSettled: () => {
        clearSession();
        queryClient.clear();
      },
    });
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('console.account_menu')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-pill bg-surface-3 ps-1 pe-3 transition-colors hover:bg-surface-2"
      >
        <Avatar name={name} id={me.data?.personId ?? 'me'} size="sm" />
        <span className="hidden text-start leading-tight md:block">
          <span className="block text-dense font-semibold text-text">{name.split(' ')[0]}</span>
          {role ? (
            <span className="block text-xs text-muted">
              {t(`console.staff_role_${role}` as MessageKey)}
            </span>
          ) : null}
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="end" className="w-60">
        <div role="menu" aria-label={t('console.account_menu')}>
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-sm font-semibold">{name}</p>
            <p className="num text-xs text-muted" dir="ltr">
              {me.data?.phoneMasked}
            </p>
            <p className="mt-1 flex flex-wrap gap-1">
              {ROLE_ORDER.filter((r) => roles.has(r)).map((r) => (
                <span
                  key={r}
                  className="rounded-pill bg-surface-3 px-2 py-px text-xs text-muted"
                >
                  {t(`console.staff_role_${r}` as MessageKey)}
                </span>
              ))}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={logout.isPending}
            className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-[8px] px-3 text-sm text-text hover:bg-surface-2"
          >
            <IconLogout size={17} className="text-muted" />
            {t('console.logout')}
          </button>
        </div>
      </Popover>
    </div>
  );
}

/** Below 1024 px: the pages as a scrolling strip under the bar. */
function MobileNav() {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  if (!signedIn) return null;
  const items = visibleNav(roles, loaded).flatMap((g) => g.items);
  return (
    <nav
      aria-label={t('app.console')}
      className="overflow-x-auto border-t border-line px-3 py-1.5 lg:hidden"
    >
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-9 items-center gap-2 rounded-md px-3 text-sm',
                  active
                    ? 'bg-accent-tint font-semibold text-text'
                    : 'text-muted hover:text-text',
                )}
              >
                <Icon size={16} className={active ? 'text-accent-text' : ''} />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
