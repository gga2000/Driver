'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { orderTicketNumber } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  flatten,
  intentOf,
  rankCommands,
  type CommandGroup,
  type CommandItem,
} from '@/lib/command';
import { formatDayClock } from '@/lib/format';
import { orderStateLabel } from '@/lib/labels';
import { CITY_ID, queryRetry, useMerchants } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { personText, useNames } from '@/lib/names';
import { visibleNav, type IconName } from '@/lib/nav';
import { setDensity, setTheme, useDensity, useTheme } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { requestNewTicket } from '@/lib/support-store';
import { useTRPC } from '@/lib/trpc';
import {
  cx,
  IconDensity,
  IconDrivers,
  IconKeyboard,
  IconMoon,
  IconOrders,
  IconPlus,
  IconSearch,
  IconStore,
  IconSun,
  Kbd,
  Spinner,
  type IconProps,
} from '../ui';
import { NAV_ICONS } from './sidebar';

/**
 * ⌘K / Ctrl+K (S-K3): one box for "#1284", a driver, a restaurant, a page or an action. Orders are
 * looked up by ticket number through `orders.search`; drivers and restaurants are matched by name
 * in the browser (names come from the logged `console.names` read the pages already use).
 */
export function CommandPalette({
  open,
  onClose,
  onShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  onShortcuts: () => void;
}) {
  if (!open) return null;
  return <PaletteBody onClose={onClose} onShortcuts={onShortcuts} />;
}

const GROUP_ICON: Partial<Record<CommandGroup, ComponentType<IconProps>>> = {
  orders: IconOrders,
  drivers: IconDrivers,
  merchants: IconStore,
};

function PaletteBody({ onClose, onShortcuts }: { onClose: () => void; onShortcuts: () => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const theme = useTheme();
  const density = useDensity();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const intent = intentOf(q);

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.activeElement as HTMLElement | null;
    return () => prev?.focus?.();
  }, []);

  const orders = useQuery(
    trpc.orders.search.queryOptions(
      { cityId: CITY_ID, text: intent.ticket ?? '', limit: 8 },
      { enabled: signedIn && intent.ticket !== null, retry: queryRetry },
    ),
  );
  const merchants = useMerchants();
  const roster = useQuery(
    trpc.drivers.list.queryOptions(
      { cityId: CITY_ID, limit: 100, filter: { presence: 'all' } },
      { enabled: signedIn && loaded && roles.size > 0, retry: queryRetry, staleTime: 60_000 },
    ),
  );
  const driverIds = useMemo(() => (roster.data?.rows ?? []).map((r) => r.personId), [roster.data]);
  const names = useNames({
    people: driverIds,
    orgs: (orders.data?.rows ?? []).map((o) => o.merchantOrgId ?? '').filter(Boolean),
  });

  const items = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];
    for (const g of visibleNav(roles, loaded)) {
      for (const item of g.items)
        out.push({
          id: `p:${item.href}`,
          group: 'pages',
          label: t(item.key),
          href: item.href,
          icon: item.icon,
          keywords: [t(g.key)],
          hint: t(g.key),
        });
    }
    out.push(
      {
        id: 'a:new-ticket',
        group: 'actions',
        label: t('console.palette_new_ticket'),
        keywords: ['تذكرة', 'شكوى'],
        run: () => (requestNewTicket(), router.push('/support')),
      },
      {
        id: 'a:theme',
        group: 'actions',
        label: theme === 'dark' ? t('console.theme_light') : t('console.theme_dark'),
        keywords: ['ليلي', 'نهاري', 'ثيم'],
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'a:density',
        group: 'actions',
        label:
          density === 'compact' ? t('console.density_comfortable') : t('console.density_compact'),
        keywords: ['كثافة', 'مضغوط'],
        run: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
      },
      {
        id: 'a:keys',
        group: 'actions',
        label: t('console.shortcuts_open'),
        keywords: ['كيبورد', 'اختصار'],
        run: onShortcuts,
      },
      {
        id: 'a:design',
        group: 'actions',
        label: t('console.design_title'),
        keywords: ['تصميم', 'مكونات', 'ألوان'],
        href: '/design',
      },
    );
    for (const m of merchants.data ?? [])
      out.push({
        id: `m:${m.merchantId}`,
        group: 'merchants',
        label: m.name,
        href: `/orders?merchant=${encodeURIComponent(m.merchantId)}`,
      });
    for (const r of roster.data?.rows ?? []) {
      const label = personText(r.personId, names.person(r.personId), {
        vehicle: true,
        vehicleClass: r.vehicleClass,
      });
      if (label)
        out.push({
          id: `d:${r.personId}`,
          group: 'drivers',
          label,
          hint: r.online ? t('console.presence_online') : undefined,
          href: `/drivers/${encodeURIComponent(r.personId)}/ledger`,
        });
    }
    for (const o of orders.data?.rows ?? []) {
      const merchant = o.merchantOrgId ? (names.org(o.merchantOrgId)?.name ?? '') : '';
      out.push({
        id: `o:${o.id}`,
        group: 'orders',
        label: `#${orderTicketNumber(o.id)}`,
        hint: [merchant, formatDayClock(o.placedAt), orderStateLabel(o.state)]
          .filter(Boolean)
          .join(' · '),
        href: `/orders/${encodeURIComponent(o.id)}`,
      });
    }
    return out;
  }, [
    roles,
    loaded,
    theme,
    density,
    merchants.data,
    roster.data,
    orders.data,
    names,
    router,
    onShortcuts,
  ]);

  const groups = useMemo(() => rankCommands(q, items), [q, items]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  const searching = intent.ticket !== null && orders.isFetching;
  let index = -1;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] px-4 pt-[12vh] animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('console.palette_title')}
        className="flex max-h-[72vh] w-[min(640px,100%)] animate-pop-in flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-overlay"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <IconSearch size={20} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            aria-label={t('console.palette_placeholder')}
            placeholder={t('console.palette_placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(current);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-text placeholder:text-faint focus-visible:outline-none"
          />
          {searching ? <Spinner className="text-muted" /> : <Kbd>esc</Kbd>}
        </div>
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={t('console.palette_title')}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold">
                {searching ? t('console.palette_searching') : t('console.palette_empty')}
              </p>
              {!searching ? (
                <p className="mt-1 text-dense text-muted">{t('console.palette_empty_hint')}</p>
              ) : null}
            </div>
          ) : null}
          {groups.map((g) => (
            <div
              key={g.group}
              role="group"
              aria-label={t(`console.palette_group_${g.group}` as MessageKey)}
            >
              <p className="px-3 pb-1 pt-3 text-xs font-medium text-faint">
                {t(`console.palette_group_${g.group}` as MessageKey)}
              </p>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const on = current?.id === item.id;
                const Icon = itemIcon(item, theme);
                return (
                  <div
                    key={item.id}
                    id={`${id}-${item.id}`}
                    role="option"
                    aria-selected={on}
                    data-active={on}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cx(
                      'relative flex h-11 cursor-pointer items-center gap-3 rounded-md px-3',
                      on ? 'bg-surface-2' : '',
                    )}
                  >
                    {on ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-2.5 start-0 w-[3px] rounded-pill bg-accent"
                      />
                    ) : null}
                    <Icon size={18} className={on ? 'text-accent-text' : 'text-muted'} />
                    <span
                      className={cx(
                        'min-w-0 truncate text-sm',
                        item.group === 'orders' ? 'num font-semibold' : 'font-medium',
                      )}
                      dir={item.group === 'orders' ? 'ltr' : undefined}
                    >
                      {item.label}
                    </span>
                    {item.hint ? (
                      <span className="min-w-0 flex-1 truncate text-dense text-muted">
                        {item.hint}
                      </span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {on ? <Kbd>↵</Kbd> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2/60 px-4 py-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t('console.palette_nav')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t('console.palette_pick')}
          </span>
          <span className="ms-auto inline-flex items-center gap-1.5">
            <Kbd>?</Kbd>
            {t('console.shortcuts')}
          </span>
        </div>
      </div>
    </div>
  );
}

function itemIcon(item: CommandItem, theme: 'light' | 'dark'): ComponentType<IconProps> {
  if (item.icon && item.icon in NAV_ICONS) return NAV_ICONS[item.icon as IconName];
  if (item.id === 'a:theme') return theme === 'dark' ? IconSun : IconMoon;
  if (item.id === 'a:density') return IconDensity;
  if (item.id === 'a:keys') return IconKeyboard;
  if (item.id === 'a:new-ticket') return IconPlus;
  return GROUP_ICON[item.group] ?? IconSearch;
}
