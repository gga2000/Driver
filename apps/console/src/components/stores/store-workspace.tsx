'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { STORE_SETUP_EDIT_ROLES } from '@driver/contracts/store-setup';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { formatDayClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useTRPC } from '@/lib/trpc';
import { useLinkedFilters } from '@/lib/url-state';
import { Button, Card, Chip, QueryError, Sheet, Skeleton, Tabs, type ChipTone } from '../ui';
import { StoreHistory } from './store-history';
import { StoreShop } from './store-shop';

// The heavy editors load with their tab, the phone preview on very wide screens only (a sheet below that).
const MenuEditor = dynamic(() => import('./menu-editor').then((m) => m.MenuEditor), { ssr: false, loading: () => <TabLoading /> });
const HoursEditor = dynamic(() => import('./hours-editor').then((m) => m.HoursEditor), { ssr: false, loading: () => <TabLoading /> });
const PhonePreview = dynamic(() => import('./phone-preview').then((m) => m.PhonePreview), { ssr: false });

export type StoreTab = 'shop' | 'menu' | 'hours' | 'pickup' | 'log';
const TABS: readonly StoreTab[] = ['shop', 'menu', 'hours', 'pickup', 'log'];
const TAB_KEY: Record<StoreTab, 'console.stores.tab_shop' | 'console.stores.tab_menu' | 'console.stores.tab_hours' | 'console.stores.tab_pickup' | 'console.stores.tab_log'> = {
  shop: 'console.stores.tab_shop',
  menu: 'console.stores.tab_menu',
  hours: 'console.stores.tab_hours',
  pickup: 'console.stores.tab_pickup',
  log: 'console.stores.tab_log',
};
const LINK_DEFAULTS = { tab: 'shop' };
const LINK_ALLOWED = { tab: TABS };

function TabLoading() {
  return (
    <div className="space-y-3" aria-busy>
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-40 w-full rounded-md" />
    </div>
  );
}

/**
 * One store, the way our team sets it up for its owner (Ali picked the mix, 2026-10-21): a header with
 * where it stands, tabs for the shop, the menu, the hours, the pickup spot and the history, and the
 * customer's view of it beside them on a wide screen. Field ops and admins change it; support reads.
 */
export function StoreWorkspace({ storeId, pickup }: { storeId: string; pickup: React.ReactNode }) {
  const trpc = useTRPC();
  const { roles } = useMyRoles();
  const canEdit = hasAny(roles, STORE_SETUP_EDIT_ROLES);
  const [tab, setTab] = useState<StoreTab>('shop');
  const [previewing, setPreviewing] = useState(false);
  useLinkedFilters({ tab }, LINK_DEFAULTS, (got) => got['tab'] && setTab(got['tab'] as StoreTab), LINK_ALLOWED);
  const scope = { merchantOrgId: storeId };
  const status = useQuery(trpc.ops.stores.status.queryOptions(scope, { retry: queryRetry }));
  const setup = useQuery(trpc.ops.stores.setup.queryOptions(scope, { retry: queryRetry }));
  const history = useQuery(trpc.ops.stores.history.queryOptions({ ...scope, limit: 1 }, { retry: queryRetry }));

  if (status.error) return <QueryError error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const inSetup = setup.data?.active === true && !setup.data.live;
  const state: { tone: ChipTone; label: string } = !s
    ? { tone: 'neutral', label: '' }
    : inSetup
      ? { tone: 'ready', label: t('console.stores.state_setup', { done: setup.data?.progress.done ?? 0, total: setup.data?.progress.total ?? 7 }) }
      : s.open
        ? { tone: 'done', label: s.busy.on ? t('console.stores.state_busy', { min: s.busy.extraPrepMinutes }) : t('console.stores.state_live') }
        : { tone: 'warn', label: t('console.stores.state_closed') };
  const last = history.data?.[0];

  return (
    <div className="space-y-4">
      <Card>
        {!s ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-6 w-1/2 rounded-md" />
            <Skeleton className="h-4 w-1/3 rounded-md" />
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-text">{s.name}</h2>
              <p className="mt-1 text-dense text-muted">
                {last ? t('console.stores.last_edit', { name: last.actorName ?? t('console.someone'), when: formatDayClock(last.at) }) : t('console.stores.no_edits')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={state.tone} dot>
                {state.label}
              </Chip>
              {!canEdit ? <Chip tone="neutral">{t('console.stores.read_only')}</Chip> : null}
              <Button size="lg" variant="ghost" className="min-[1760px]:hidden" onClick={() => setPreviewing(true)}>
                {t('console.stores.preview_open')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Tabs label={t('console.stores.tabs')} value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: t(TAB_KEY[v]) }))} />

      <div className="grid items-start gap-5 min-[1760px]:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {tab === 'shop' ? <StoreShop storeId={storeId} canEdit={canEdit} onGo={setTab} /> : null}
          {tab === 'menu' ? <MenuEditor storeId={storeId} canEdit={canEdit} inSetup={inSetup} /> : null}
          {tab === 'hours' ? <HoursEditor storeId={storeId} canEdit={canEdit} /> : null}
          {tab === 'pickup' ? pickup : null}
          {tab === 'log' ? <StoreHistory storeId={storeId} /> : null}
        </div>
        <aside className="hidden min-[1760px]:block" aria-label={t('console.stores.preview')}>
          <PhonePreview storeId={storeId} />
        </aside>
      </div>
      {previewing ? (
        <Sheet open onClose={() => setPreviewing(false)} title={t('console.stores.preview')} width="22rem">
          <PhonePreview storeId={storeId} />
        </Sheet>
      ) : null}
    </div>
  );
}
