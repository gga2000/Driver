'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditEntry,
  BannerAudience,
  BannerSeverity,
  BoardPolicy,
  ControlsView,
  KillScope,
  KillSwitchView,
  SystemBannerView,
  Vertical,
  ZoneCapacityView,
} from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { POLICY_MODES, policyMode, setPolicyInput, type PolicyMode } from '@/lib/board';
import {
  activeSwitch,
  BANNER_HOURS,
  bannerTone,
  defaultRefusal,
  ETA_CHOICES,
  EXPIRY_KEYS,
  expiryAt,
  gaugePct,
  gaugeTone,
  matrixCell,
  modeExplainKey,
  sortZones,
  switchUntil,
  throttlePreview,
  ZONE_VERTICALS,
  zoneNeedsRow,
  type ExpiryKey,
  type MatrixCell,
} from '@/lib/control-room';
import { formatClock, formatDayClock } from '@/lib/format';
import { tierLabel, verticalLabel } from '@/lib/labels';
import { CITY_ID, queryRetry, SLOW_POLL_MS } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Chip,
  cx,
  Dialog,
  Field,
  IconBell,
  IconCheckCircle,
  IconClock,
  IconSearch,
  IconShield,
  IconStop,
  Input,
  LiveBadge,
  Meter,
  NeedLogin,
  PageHeader,
  QueryError,
  Segmented,
  Select,
  Skeleton,
  Stat,
  StatStrip,
  Switch,
  Textarea,
  useToast,
} from './ui';
import { ScreensCard } from './screens-card';
import { SeasonsCard } from './seasons-card';
import { UnmetSearchesCard } from './unmet-searches-card';

/** What a switch dialog acts on. */
export interface SwitchTarget {
  scope: KillScope;
  key: string;
  label: string;
  /** Switching it back on (the current one is active). */
  restore: boolean;
  vertical?: Vertical | null;
  /** The switch being restored (who stopped it, why, the message customers get). */
  current?: KillSwitchView | null;
}

const SEVERITIES: readonly BannerSeverity[] = ['info', 'warning', 'critical'];
const AUDIENCES: readonly BannerAudience[] = ['customer', 'partner', 'merchant'];
const MODE_KEY = {
  broadcast: 'console.policy_broadcast',
  auto: 'console.policy_auto',
  suggest: 'console.policy_suggest',
  fixed: 'console.policy_fixed',
} as const satisfies Record<PolicyMode, MessageKey>;
type SetMode = (typeof POLICY_MODES)[number];

export function ControlsPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const canSwitch = hasAny(roles, ['admin', 'dispatcher']);
  const view = useQuery(
    trpc.ops.controls.view.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: SLOW_POLL_MS, retry: queryRetry },
    ),
  );
  const audit = useQuery(
    trpc.ops.controls.audit.queryOptions(
      { cityId: CITY_ID, limit: 60 },
      { enabled: signedIn, refetchInterval: 15_000, retry: queryRetry },
    ),
  );
  const banners = useQuery(
    trpc.system.banners.queryOptions(undefined, {
      enabled: signedIn,
      refetchInterval: 15_000,
      retry: queryRetry,
    }),
  );
  // The dispatch modes live on the board read (dispatchers and admins only).
  const board = useQuery(
    trpc.dispatch.board.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn && canSwitch, refetchInterval: 15_000, retry: queryRetry },
    ),
  );
  const [target, setTarget] = useState<SwitchTarget | null>(null);
  const [zone, setZone] = useState<ZoneCapacityView | null>(null);
  const [policy, setPolicy] = useState<{ p: BoardPolicy; mode: SetMode | 'reset' } | null>(null);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.ctl_title')} subtitle={t('console.ctl_subtitle')} />
        <NeedLogin />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.ctl_title')} subtitle={t('console.ctl_subtitle')}>
        <LiveBadge
          seconds={SLOW_POLL_MS / 1000}
          updatedAt={view.dataUpdatedAt}
          fetching={view.isFetching}
          error={Boolean(view.error)}
        />
      </PageHeader>
      {view.error && <QueryError error={view.error} onRetry={() => void view.refetch()} />}
      {!view.data && view.isPending && <ControlsSkeleton />}
      {view.data && (
        <ControlsBoard
          view={view.data}
          audit={audit.data ?? []}
          banners={banners.data ?? []}
          canSwitch={canSwitch}
          canBanner={roles.has('admin')}
          onSwitch={setTarget}
          onZone={setZone}
          policies={canSwitch ? (board.data?.policies ?? null) : undefined}
          onPolicy={(p, mode) => setPolicy({ p, mode })}
        />
      )}
      {view.data && (
        <div className="mt-6 space-y-5">
          <ScreensCard signedIn={signedIn} canShow={roles.has('admin')} canOff={canSwitch} />
          <SeasonsCard signedIn={signedIn} canEdit={roles.has('admin')} />
          <UnmetSearchesCard signedIn={signedIn} />
        </div>
      )}
      <SwitchDialog target={target} onClose={() => setTarget(null)} />
      <CapacityDialog zone={zone} onClose={() => setZone(null)} />
      <PolicyDialog change={policy} onClose={() => setPolicy(null)} />
    </div>
  );
}

function ControlsSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

/** The page body from data (smoke-tested without a server). */
export function ControlsBoard({
  view,
  audit,
  banners,
  canSwitch,
  canBanner,
  onSwitch,
  onZone,
  policies,
  onPolicy,
}: {
  view: ControlsView;
  audit: AuditEntry[];
  banners: SystemBannerView[];
  canSwitch: boolean;
  canBanner: boolean;
  onSwitch: (t: SwitchTarget) => void;
  onZone: (z: ZoneCapacityView) => void;
  /** Dispatch modes per vertical: `undefined` hides the section (role), `null` while loading. */
  policies?: BoardPolicy[] | null;
  onPolicy?: (p: BoardPolicy, mode: SetMode | 'reset') => void;
}) {
  const on = view.switches.filter((s) => s.active);
  const full = view.zones.filter((z) => z.state === 'full');
  const throttled = view.zones.filter((z) => z.maxActive !== null);
  const liveBanner = banners.find((b) => b.active);
  const controlLog = audit.filter(
    (a) =>
      a.subjectKind === 'kill_switch' ||
      a.subjectKind === 'capacity' ||
      a.subjectKind === 'banner' ||
      a.subjectKind === 'screen',
  );
  return (
    <div className="space-y-5">
      <StatStrip className="md:[grid-template-columns:repeat(4,minmax(0,1fr))]">
        <Stat
          label={t('console.ctl_stat_switches')}
          value={on.length}
          tone={on.length > 0 ? 'bad' : 'default'}
          hint={
            on.length > 0
              ? on
                  .map((s) => s.label_ar)
                  .slice(0, 3)
                  .join(t('console.list_sep'))
              : t('console.ctl_all_running')
          }
        />
        <Stat
          label={t('console.ctl_stat_full')}
          value={full.length}
          tone={full.length ? 'bad' : 'default'}
          hint={
            full
              .map((z) => z.name_ar)
              .slice(0, 3)
              .join(t('console.list_sep')) || t('console.ctl_no_pressure')
          }
        />
        <Stat
          label={t('console.ctl_stat_active_orders')}
          value={view.activeOrders}
          hint={t('console.ctl_stat_throttled', { n: throttled.length })}
        />
        <Stat
          label={t('console.ctl_stat_banner')}
          value={
            liveBanner
              ? t(`console.banner_sev_${liveBanner.severity}` as MessageKey)
              : t('console.ctl_banner_none')
          }
          tone={liveBanner?.severity === 'critical' ? 'bad' : liveBanner ? 'warn' : 'default'}
          hint={
            liveBanner
              ? t('console.ctl_banner_until', { time: formatClock(liveBanner.expiresAt) })
              : t('console.ctl_banner_none_hint')
          }
        />
      </StatStrip>

      <StoppedNow switches={view.switches} canSwitch={canSwitch} onSwitch={onSwitch} />

      <ServicesCard view={view} canSwitch={canSwitch} onSwitch={onSwitch} />

      <ZoneMatrix view={view} canSwitch={canSwitch} onSwitch={onSwitch} onZone={onZone} />

      <RestaurantsCard view={view} canSwitch={canSwitch} onSwitch={onSwitch} />

      <BannerCard banners={banners} canBanner={canBanner} />

      <div
        className={cx(
          'grid items-start gap-5',
          policies !== undefined && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]',
        )}
      >
        {policies !== undefined && (
          <DispatchModes
            policies={policies}
            canSwitch={canSwitch}
            onPolicy={onPolicy ?? (() => undefined)}
          />
        )}
        <AuditCard entries={controlLog} />
      </div>
    </div>
  );
}

// ───────────────────────── what is stopped right now ─────────────────────────

function StoppedNow({
  switches,
  canSwitch,
  onSwitch,
}: {
  switches: KillSwitchView[];
  canSwitch: boolean;
  onSwitch: (t: SwitchTarget) => void;
}) {
  const on = switches.filter((s) => s.active);
  const restored = switches.filter((s) => !s.active).slice(0, 4);
  if (on.length === 0) {
    return (
      <section
        aria-label={t('console.ctl_on_now')}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4 shadow-card"
      >
        <p className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-ok-tint text-ok">
            <IconCheckCircle size={20} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">
              {t('console.ctl_nothing_stopped')}
            </span>
            <span className="block text-dense text-muted">
              {t('console.ctl_nothing_stopped_hint')}
            </span>
          </span>
        </p>
        {restored.length > 0 && <RestoredLine restored={restored} />}
      </section>
    );
  }
  return (
    <section
      aria-label={t('console.ctl_on_now')}
      className="rounded-lg border border-bad/45 bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <IconStop size={18} className="text-bad" />
          {t('console.ctl_on_now')}
          <span className="num text-dense font-medium text-muted">{on.length}</span>
        </h2>
        {restored.length > 0 && <RestoredLine restored={restored} />}
      </header>
      <ul className={cx('grid', on.length > 1 && 'md:grid-cols-2')}>
        {on.map((s, i) => (
          <li
            key={s.id}
            className={cx(
              'flex flex-col gap-2 px-5 py-4',
              i > 0 && 'border-t border-line',
              on.length > 1 && i === 1 && 'md:border-t-0 md:border-s',
              on.length > 1 && i > 1 && i % 2 === 1 && 'md:border-s',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {s.label_ar}
                  <Chip tone="bad" size="sm">
                    {t(`console.ctl_scope_${s.scope}` as MessageKey)}
                  </Chip>
                  {s.scope === 'zone' && s.vertical && (
                    <Chip size="sm">
                      {t('console.ctl_only_vertical', { name: verticalLabel(s.vertical) })}
                    </Chip>
                  )}
                  {s.holdDispatch && (
                    <Chip tone="warn" size="sm">
                      {t('console.ctl_hold_chip')}
                    </Chip>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-text">{s.reason}</p>
              </div>
              {canSwitch && (
                <Button
                  size="sm"
                  onClick={() =>
                    onSwitch({
                      scope: s.scope,
                      key: s.key,
                      label: s.label_ar,
                      restore: true,
                      vertical: s.vertical,
                      current: s,
                    })
                  }
                >
                  {t('console.ctl_restore')}
                </Button>
              )}
            </div>
            <p className="rounded-md bg-surface-2 px-3 py-2 text-dense text-muted">
              <span className="font-medium text-text">{t('console.ctl_customer_sees')}</span> «
              {s.message_ar ?? defaultRefusal(s.scope, s.label_ar, s.expiresAt)}»
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>
                {t('console.ctl_stopped_by', {
                  name: s.setByName ?? t('console.someone'),
                  time: formatClock(s.setAt),
                })}
              </span>
              <span
                className={cx('inline-flex items-center gap-1', s.expiresAt ? 'text-text' : '')}
              >
                <IconClock size={14} />
                {switchUntil(s)}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestoredLine({ restored }: { restored: KillSwitchView[] }) {
  return (
    <p className="text-xs text-muted">
      {t('console.ctl_recent_restored')}:{' '}
      {restored.map((s, i) => (
        <span key={s.id}>
          {i > 0 ? t('console.list_sep') : ''}
          {s.label_ar} <span className="num">{formatClock(s.setAt)}</span>
        </span>
      ))}
    </p>
  );
}

// ───────────────────────── whole-city services ─────────────────────────

function ServicesCard({
  view,
  canSwitch,
  onSwitch,
}: {
  view: ControlsView;
  canSwitch: boolean;
  onSwitch: (t: SwitchTarget) => void;
}) {
  return (
    <Card
      title={t('console.ctl_services')}
      hint={t('console.ctl_services_hint')}
      actions={!canSwitch ? <Chip>{t('console.ctl_read_only')}</Chip> : undefined}
    >
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {view.verticals.map((v) => (
          <li key={v.key}>
            <Breaker
              title={verticalLabel(v.key)}
              sw={activeSwitch(view, 'vertical', v.key)}
              killed={v.killed}
              disabled={!canSwitch}
              onToggle={() =>
                onSwitch({
                  scope: 'vertical',
                  key: v.key,
                  label: v.label_ar,
                  restore: v.killed,
                  current: activeSwitch(view, 'vertical', v.key),
                })
              }
            />
          </li>
        ))}
      </ul>
      {view.corridors.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-dense font-semibold text-muted">
            {t('console.ctl_group_corridors')}
          </h3>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {view.corridors.map((c) => (
              <li key={c.key}>
                <Breaker
                  title={c.label_ar}
                  sw={activeSwitch(view, 'corridor', c.key)}
                  killed={c.killed}
                  disabled={!canSwitch}
                  onToggle={() =>
                    onSwitch({
                      scope: 'corridor',
                      key: c.key,
                      label: c.label_ar,
                      restore: c.killed,
                      current: activeSwitch(view, 'corridor', c.key),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** One big switch: name, state in words (with the time it comes back), the switch on the end side. */
function Breaker({
  title,
  sw,
  killed,
  disabled,
  onToggle,
  compact = false,
}: {
  title: string;
  sw: KillSwitchView | null;
  killed: boolean;
  disabled: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex items-center justify-between gap-3 rounded-md border px-3.5 transition-colors duration-fast',
        compact ? 'min-h-[48px] py-1.5' : 'min-h-[60px] py-2',
        killed ? 'border-bad/45 bg-bad-tint' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <div className="min-w-0">
        <p
          className={cx('truncate font-semibold text-text', compact ? 'text-dense' : 'text-sm')}
          title={title}
        >
          {title}
        </p>
        <p
          className={cx(
            'flex items-center gap-1 truncate text-xs',
            killed ? 'text-bad' : 'text-muted',
          )}
        >
          {killed ? (
            <>
              <IconStop size={13} className="shrink-0" />
              {t('console.ctl_state_off')}
              {sw ? ` · ${switchUntil(sw)}` : ''}
            </>
          ) : (
            t('console.ctl_state_on')
          )}
        </p>
      </div>
      <Switch
        on={!killed}
        onToggle={onToggle}
        disabled={disabled}
        size={compact ? 'sm' : 'md'}
        label={
          killed
            ? t('console.ctl_aria_restore', { name: title })
            : t('console.ctl_aria_stop', { name: title })
        }
      />
    </div>
  );
}

// ───────────────────────── zones × services ─────────────────────────

const SHORT_ROWS = 8;

function ZoneMatrix({
  view,
  canSwitch,
  onSwitch,
  onZone,
}: {
  view: ControlsView;
  canSwitch: boolean;
  onSwitch: (t: SwitchTarget) => void;
  onZone: (z: ZoneCapacityView) => void;
}) {
  const ids = { q: useId() };
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const zones = useMemo(() => sortZones(view.zones), [view.zones]);
  const needs = zones.filter((z) => zoneNeedsRow(view, z));
  const query = q.trim();
  const shown = query
    ? zones.filter((z) => z.name_ar.includes(query))
    : all
      ? zones
      : needs.length >= SHORT_ROWS
        ? needs
        : zones.slice(0, Math.max(SHORT_ROWS, needs.length));
  const hidden = zones.length - shown.length;
  return (
    <Card
      title={t('console.ctl_zones_matrix')}
      hint={t('console.ctl_zones_matrix_hint')}
      flush
      actions={
        <span className="relative block w-48">
          <label htmlFor={ids.q} className="sr-only">
            {t('console.ctl_zone_search')}
          </label>
          <Input
            id={ids.q}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('console.ctl_zone_search')}
            leading={<IconSearch size={16} />}
            className="h-8 text-dense"
          />
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-dense">
          <caption className="sr-only">{t('console.ctl_zones_matrix')}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[190px] border-b border-line px-5 py-2 text-start text-xs font-medium text-muted"
              >
                {t('console.ctl_col_zone')}
              </th>
              <th
                scope="col"
                className="w-[180px] border-b border-line px-3 py-2 text-start text-xs font-medium text-muted"
              >
                {t('console.ctl_col_load')}
              </th>
              <th
                scope="col"
                className="border-b border-s border-line px-1.5 py-2 text-center text-xs font-semibold text-text"
              >
                {t('console.ctl_zone_all')}
              </th>
              {ZONE_VERTICALS.map((v) => (
                <th
                  key={v}
                  scope="col"
                  className="border-b border-line px-1.5 py-2 text-center text-xs font-medium text-muted"
                >
                  {verticalLabel(v)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((z) => {
              const whole = matrixCell(view, z.zoneKey, null);
              return (
                <tr
                  key={z.zoneKey}
                  className={cx(
                    'group',
                    whole.state === 'off' ? 'bg-bad-tint/40' : 'hover:bg-surface-2/60',
                  )}
                >
                  <th
                    scope="row"
                    className="border-b border-line/70 px-5 py-1.5 text-start font-normal"
                  >
                    <span
                      className="block truncate text-sm font-semibold text-text"
                      title={z.name_ar}
                    >
                      {z.name_ar}
                    </span>
                    <span className="block text-xs text-muted">{tierLabel(z.tier as never)}</span>
                  </th>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    <LoadGauge z={z} canEdit={canSwitch} onEdit={() => onZone(z)} />
                  </td>
                  <td className="border-b border-s border-line/70 px-1.5 py-1.5">
                    <MatrixButton
                      cell={whole}
                      zone={z.name_ar}
                      service={t('console.ctl_zone_all')}
                      disabled={!canSwitch}
                      onClick={() =>
                        onSwitch({
                          scope: 'zone',
                          key: z.zoneKey,
                          label: z.name_ar,
                          restore: whole.state === 'off',
                          vertical: null,
                          current: whole.sw,
                        })
                      }
                    />
                  </td>
                  {ZONE_VERTICALS.map((v) => {
                    const cell = matrixCell(view, z.zoneKey, v);
                    return (
                      <td key={v} className="border-b border-line/70 px-1.5 py-1.5">
                        <MatrixButton
                          cell={cell}
                          zone={z.name_ar}
                          service={verticalLabel(v)}
                          disabled={!canSwitch}
                          onClick={() =>
                            onSwitch({
                              scope: 'zone',
                              key: z.zoneKey,
                              label: z.name_ar,
                              restore: cell.state === 'off',
                              vertical: v,
                              current: cell.sw,
                            })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-pill bg-ok-solid" /> {t('console.ctl_legend_on')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IconStop size={13} className="text-bad" /> {t('console.ctl_legend_off')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded-[4px] bg-surface-3 px-1 text-xs">
              {t('console.ctl_cell_city')}
            </span>{' '}
            {t('console.ctl_legend_city')}
          </span>
        </p>
        {!query && (hidden > 0 || all) && (
          <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? t('console.ctl_zones_fewer') : t('console.ctl_zones_all', { n: zones.length })}
          </Button>
        )}
      </div>
    </Card>
  );
}

function LoadGauge({
  z,
  canEdit,
  onEdit,
}: {
  z: ZoneCapacityView;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const tone = gaugeTone(z.state);
  const meterTone = z.state === 'full' ? 'bad' : z.state === 'busy' ? 'warn' : 'ok';
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onEdit}
      title={t('console.ctl_edit_cap')}
      aria-label={`${t('console.ctl_cap_title', { name: z.name_ar })}: ${z.active} / ${z.maxActive ?? t('console.ctl_no_cap')}`}
      className="group/g block w-full rounded-md px-1.5 py-1 text-start transition-colors duration-fast hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="num text-sm font-semibold text-text">
          {z.active}
          <span className="font-normal text-muted"> / {z.maxActive ?? '—'}</span>
        </span>
        {z.maxActive !== null && z.state !== 'off' ? (
          <span
            className={cx(
              'text-xs font-medium',
              z.state === 'full' ? 'text-bad' : z.state === 'busy' ? 'text-warn' : 'text-muted',
            )}
          >
            {t(`console.zone_state_${z.state}` as MessageKey)}
          </span>
        ) : (
          <span className="text-xs text-faint group-hover/g:text-accent-text">
            {z.maxActive === null
              ? t('console.ctl_set_cap')
              : t(`console.zone_state_${z.state}` as MessageKey)}
          </span>
        )}
      </span>
      <span className="mt-1 block">
        {z.maxActive !== null ? (
          <Meter value={z.active} max={z.maxActive} tone={meterTone} label={z.name_ar} />
        ) : (
          <span
            className={cx(
              'block h-1.5 rounded-pill bg-surface-3',
              tone.bar === 'bg-faint' && 'opacity-60',
            )}
          />
        )}
      </span>
    </button>
  );
}

function MatrixButton({
  cell,
  zone,
  service,
  disabled,
  onClick,
}: {
  cell: MatrixCell;
  zone: string;
  service: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const inherited = cell.state === 'city' || cell.state === 'zone';
  const label =
    cell.state === 'on'
      ? t('console.ctl_cell_aria_on', { service, zone })
      : cell.state === 'off'
        ? t('console.ctl_cell_aria_off', { service, zone })
        : cell.state === 'zone'
          ? t('console.ctl_cell_aria_zone', { service, zone })
          : t('console.ctl_cell_aria_city', { service, zone });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || inherited}
      aria-pressed={cell.state === 'off'}
      aria-label={label}
      title={label}
      className={cx(
        'flex h-9 w-full min-w-[52px] items-center justify-center gap-1 rounded-md border text-xs transition-colors duration-fast disabled:cursor-default',
        cell.state === 'on' &&
          'border-transparent text-muted hover:border-bad/40 hover:bg-bad-tint/50 enabled:hover:text-bad',
        cell.state === 'off' && 'border-bad/50 bg-bad-tint font-semibold text-bad',
        cell.state === 'zone' && 'border-transparent bg-bad-tint/60 text-bad',
        cell.state === 'city' && 'border-transparent bg-surface-3 text-muted',
      )}
    >
      {cell.state === 'on' && <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-ok-solid" />}
      {cell.state === 'off' && (
        <>
          <IconStop size={14} />
          <span>{t('console.ctl_state_off')}</span>
        </>
      )}
      {cell.state === 'zone' && <span aria-hidden>·</span>}
      {cell.state === 'city' && <span>{t('console.ctl_cell_city')}</span>}
    </button>
  );
}

// ───────────────────────── restaurants ─────────────────────────

function RestaurantsCard({
  view,
  canSwitch,
  onSwitch,
}: {
  view: ControlsView;
  canSwitch: boolean;
  onSwitch: (t: SwitchTarget) => void;
}) {
  const ids = { q: useId() };
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      [...view.restaurants].sort(
        (a, b) => Number(b.killed) - Number(a.killed) || a.label_ar.localeCompare(b.label_ar, 'ar'),
      ),
    [view.restaurants],
  );
  const shown = q.trim() ? list.filter((r) => r.label_ar.includes(q.trim())) : list;
  const stopped = list.filter((r) => r.killed).length;
  return (
    <Card
      title={t('console.ctl_group_restaurants')}
      hint={
        stopped
          ? t('console.ctl_restaurants_stopped', { n: stopped, total: list.length })
          : t('console.ctl_restaurants_all_on', { total: list.length })
      }
      actions={
        list.length > 8 ? (
          <span className="block w-44">
            <label htmlFor={ids.q} className="sr-only">
              {t('console.ctl_restaurant_search')}
            </label>
            <Input
              id={ids.q}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('console.ctl_restaurant_search')}
              leading={<IconSearch size={16} />}
              className="h-8 text-dense"
            />
          </span>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('console.ctl_no_restaurants')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{t('console.ctl_no_match', { q: q.trim() })}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <li key={r.key}>
              <Breaker
                compact
                title={r.label_ar}
                sw={activeSwitch(view, 'restaurant', r.key)}
                killed={r.killed}
                disabled={!canSwitch}
                onToggle={() =>
                  onSwitch({
                    scope: 'restaurant',
                    key: r.key,
                    label: r.label_ar,
                    restore: r.killed,
                    current: activeSwitch(view, 'restaurant', r.key),
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ───────────────────────── dispatch modes (K-14: moved from /dispatch, behind a confirm) ─────────────────────────

function DispatchModes({
  policies,
  canSwitch,
  onPolicy,
}: {
  policies: BoardPolicy[] | null;
  canSwitch: boolean;
  onPolicy: (p: BoardPolicy, mode: SetMode | 'reset') => void;
}) {
  return (
    // Anchor target of the Dispatch page's "طريقة التوزيع" link (/controls#dispatch-modes).
    <div id="dispatch-modes" className="scroll-mt-6">
      <Card title={t('console.ctl_dispatch_modes')} hint={t('console.ctl_dispatch_modes_hint')}>
        {policies === null ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : policies.length === 0 ? (
          <p className="text-sm text-muted">{t('console.policy_none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {policies.map((p) => {
              const mode = policyMode(p);
              return (
                <li
                  key={p.vertical}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{verticalLabel(p.vertical)}</span>
                    {p.overridden ? (
                      <button
                        type="button"
                        disabled={!canSwitch}
                        onClick={() => onPolicy(p, 'reset')}
                        className="text-xs text-warn underline-offset-4 hover:underline disabled:no-underline"
                      >
                        {t('console.ctl_mode_overridden_reset')}
                      </button>
                    ) : (
                      <span className="block text-xs text-muted">
                        {t('console.ctl_mode_from_config')}
                      </span>
                    )}
                  </span>
                  {mode === 'fixed' ? (
                    <Chip>{t('console.policy_fixed')}</Chip>
                  ) : (
                    <Segmented<SetMode>
                      size="sm"
                      label={t('console.ctl_mode_for', { name: verticalLabel(p.vertical) })}
                      value={mode}
                      onChange={(m) => m !== mode && canSwitch && onPolicy(p, m)}
                      options={POLICY_MODES.map((m) => ({
                        value: m,
                        label: t(MODE_KEY[m]),
                        disabled: !canSwitch && m !== mode,
                      }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PolicyDialog({
  change,
  onClose,
}: {
  change: { p: BoardPolicy; mode: SetMode | 'reset' } | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation(
    trpc.dispatch.setPolicy.mutationOptions({
      onSuccess: (p) => {
        void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({
          title: t('console.policy_saved', {
            vertical: verticalLabel(p.vertical),
            mode: t(MODE_KEY[policyMode(p)]),
          }),
          tone: 'ok',
        });
        onClose();
      },
    }),
  );
  useEffect(() => {
    if (change) save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new change only
  }, [change]);
  const name = change ? verticalLabel(change.p.vertical) : '';
  const from = change ? t(MODE_KEY[policyMode(change.p)]) : '';
  const to = change && change.mode !== 'reset' ? t(MODE_KEY[change.mode]) : '';
  const confirm = () => {
    if (!change) return;
    save.mutate(
      change.mode === 'reset'
        ? { cityId: CITY_ID, vertical: change.p.vertical, clear: true }
        : setPolicyInput(CITY_ID, change.p.vertical as Vertical, change.mode),
    );
  };
  return (
    <Dialog
      open={change !== null}
      onClose={onClose}
      labelledBy="policy-title"
      width="sm"
      title={
        change?.mode === 'reset'
          ? t('console.ctl_mode_reset_title', { name })
          : t('console.ctl_mode_title', { name, mode: to })
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant="primary" needsNet loading={save.isPending} onClick={confirm}>
            {change?.mode === 'reset'
              ? t('console.ctl_mode_reset_do')
              : t('console.ctl_mode_do', { mode: to })}
          </Button>
        </>
      }
    >
      {change && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">{t('console.ctl_mode_now', { name, mode: from })}</p>
          {change.mode !== 'reset' && (
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
              {t(modeExplainKey(change.mode))}
            </p>
          )}
          <p className="text-xs text-muted">{t('console.ctl_mode_logged')}</p>
          <div role="status" className="min-h-[1.25rem]">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ───────────────────────── audit trail ─────────────────────────

const AUDIT_SHORT = 8;

function AuditCard({ entries }: { entries: AuditEntry[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, AUDIT_SHORT);
  return (
    <Card title={t('console.ctl_audit')} hint={t('console.ctl_audit_hint')}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{t('console.ctl_audit_empty')}</p>
      ) : (
        <>
          <ol className="relative space-y-3.5">
            {shown.map((a, i) => (
              <li key={a.id} className="relative flex gap-3">
                {i < shown.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute start-[13px] top-8 h-[calc(100%-14px)] w-px bg-line"
                  />
                )}
                <Avatar
                  name={a.actorName}
                  id={a.actorId}
                  size="sm"
                  className="mt-0.5 h-[26px] w-[26px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6">
                    <span className="font-semibold">{a.actorName ?? t('console.someone')}</span>{' '}
                    {a.summary_ar}
                  </p>
                  <p className="num text-xs text-muted">{formatDayClock(a.at)}</p>
                </div>
              </li>
            ))}
          </ol>
          {entries.length > AUDIT_SHORT && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setAll((x) => !x)}
              aria-expanded={all}
            >
              {all
                ? t('console.ctl_audit_fewer')
                : t('console.ctl_audit_all', { n: entries.length })}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

// ───────────────────────── banner ─────────────────────────

function BannerCard({ banners, canBanner }: { banners: SystemBannerView[]; canBanner: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { msg: useId(), hours: useId() };
  const [severity, setSeverity] = useState<BannerSeverity>('warning');
  const [audiences, setAudiences] = useState<BannerAudience[]>(['customer', 'partner', 'merchant']);
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState(2);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.system.banners.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
  };
  const set = useMutation(
    trpc.system.setBanner.mutationOptions({
      onSuccess: () => {
        setMessage('');
        refresh();
        toast({ title: t('console.banner_sent'), tone: 'ok' });
      },
    }),
  );
  const clear = useMutation(
    trpc.system.clearBanner.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: t('console.banner_cleared_toast'), tone: 'ok' });
      },
    }),
  );
  const trimmed = message.trim();
  const valid = trimmed.length >= 3 && audiences.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    set.mutate({
      cityId: CITY_ID,
      severity,
      audiences,
      message_ar: trimmed,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
    });
  };
  const toggle = (a: BannerAudience) =>
    setAudiences((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  const who =
    audiences.length === 3
      ? t('console.banner_to_all')
      : audiences.map((a) => t(`console.banner_to_${a}` as MessageKey)).join(t('console.list_and'));
  const live = banners.filter((b) => b.active);
  const past = banners.filter((b) => !b.active).slice(0, 3);
  return (
    <Card
      title={t('console.banner_title')}
      hint={t('console.banner_hint')}
      actions={!canBanner ? <Chip>{t('console.banner_admin_only')}</Chip> : undefined}
    >
      {live.length > 0 && (
        <ul className="mb-5 space-y-2">
          {live.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Chip tone={bannerTone(b.severity)} dot size="sm">
                    {t('console.banner_live')} ·{' '}
                    {t(`console.banner_sev_${b.severity}` as MessageKey)}
                  </Chip>
                  <span className="min-w-0">{b.message_ar}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {b.audiences.map((a) => t(`console.banner_app_${a}` as MessageKey)).join(t('console.list_sep'))} ·{' '}
                  {t('console.ctl_until', { time: formatClock(b.expiresAt) })} ·{' '}
                  {b.setByName ?? t('console.someone')}
                </p>
              </div>
              {canBanner && (
                <Button
                  variant="danger-soft"
                  size="sm"
                  loading={clear.isPending && clear.variables?.bannerId === b.id}
                  onClick={() => clear.mutate({ bannerId: b.id })}
                >
                  {t('console.banner_clear')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <form onSubmit={submit}>
          <fieldset disabled={!canBanner} className="space-y-4 disabled:opacity-60">
            <div className="space-y-1.5">
              <p className="text-dense font-medium">{t('console.banner_severity')}</p>
              <Segmented<BannerSeverity>
                label={t('console.banner_severity')}
                value={severity}
                onChange={setSeverity}
                options={SEVERITIES.map((s) => ({
                  value: s,
                  label: t(`console.banner_sev_${s}` as MessageKey),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-dense font-medium">{t('console.banner_who')}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {AUDIENCES.map((a) => (
                  <Checkbox
                    key={a}
                    label={t(`console.banner_app_${a}` as MessageKey)}
                    checked={audiences.includes(a)}
                    onChange={() => toggle(a)}
                  />
                ))}
              </div>
              {audiences.length === 0 && (
                <p className="text-xs text-bad">{t('console.banner_pick_app')}</p>
              )}
            </div>
            <Field
              label={t('console.banner_message')}
              htmlFor={ids.msg}
              hint={t('console.banner_count', { n: trimmed.length })}
            >
              <Textarea
                id={ids.msg}
                rows={3}
                maxLength={200}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('console.banner_placeholder')}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('console.banner_for')} htmlFor={ids.hours} className="w-36">
                <Select
                  id={ids.hours}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                >
                  {BANNER_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {t('console.banner_hours', { n: h })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={!valid}
                loading={set.isPending}
                icon={<IconBell size={16} />}
              >
                {t('console.banner_send_to', { who })}
              </Button>
            </div>
            {set.error && <p className="text-sm text-bad">{errorText(set.error)}</p>}
          </fieldset>
        </form>
        <div>
          <p className="mb-2 text-dense font-medium">{t('console.banner_preview')}</p>
          <div className="grid grid-cols-3 gap-3">
            {AUDIENCES.map((a) => (
              <AppPreview
                key={a}
                app={a}
                on={audiences.includes(a)}
                severity={severity}
                message={trimmed || t('console.banner_placeholder')}
              />
            ))}
          </div>
        </div>
      </div>
      {past.length > 0 && (
        <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
          {t('console.banner_past')}:{' '}
          {past.map((b, i) => (
            <span key={b.id}>
              {i > 0 ? ' · ' : ''}«{b.message_ar}» (
              {b.clearedAt ? t('console.banner_cleared') : t('console.banner_ended')}{' '}
              {formatDayClock(b.clearedAt ?? b.expiresAt)})
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}

const SEV_ICON: Record<BannerSeverity, typeof IconBell> = {
  info: IconBell,
  warning: IconClock,
  critical: IconShield,
};

/** How the strip looks in one app (the apps render it with `StatusBanner` from @driver/ui). */
export function BannerPreview({
  severity,
  message,
}: {
  severity: BannerSeverity;
  message: string;
}) {
  const cls =
    severity === 'critical'
      ? 'border-bad-solid bg-bad-tint text-bad'
      : severity === 'warning'
        ? 'border-warn-solid bg-warn-tint text-warn'
        : 'border-info-solid bg-info-tint text-info';
  const dot =
    severity === 'critical'
      ? 'bg-bad-solid'
      : severity === 'warning'
        ? 'bg-warn-solid'
        : 'bg-info-solid';
  const Icon = SEV_ICON[severity];
  return (
    <div className={cx('flex items-start gap-2 border-b px-2 py-1.5', cls)}>
      <span
        className={cx(
          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill text-surface',
          dot,
        )}
      >
        <Icon size={12} />
      </span>
      <span
        className={cx(
          'line-clamp-3 text-xs leading-[17px]',
          severity === 'critical' ? 'font-bold' : 'font-semibold',
        )}
      >
        {message}
      </span>
    </div>
  );
}

const APP_TITLE: Record<BannerAudience, MessageKey> = {
  customer: 'console.banner_app_title_customer',
  partner: 'console.banner_app_title_partner',
  merchant: 'console.banner_app_title_merchant',
};

/** A small phone (light island: the apps are light) with the app's header, the strip and a sketch of the screen. */
function AppPreview({
  app,
  on,
  severity,
  message,
}: {
  app: BannerAudience;
  on: boolean;
  severity: BannerSeverity;
  message: string;
}) {
  return (
    <figure className="min-w-0">
      <div
        data-theme="light"
        aria-hidden
        className={cx(
          'relative overflow-hidden rounded-[18px] border-[5px] border-inverse bg-canvas text-text shadow-card transition-opacity duration-fast',
          !on && 'opacity-40',
        )}
      >
        <div className="flex items-center justify-between bg-surface px-2 py-1.5">
          <span className="text-xs font-bold">{t(APP_TITLE[app])}</span>
          <span className="h-3.5 w-3.5 rounded-pill bg-accent" />
        </div>
        {on && <BannerPreview severity={severity} message={message} />}
        <div className="space-y-1.5 p-2">
          <div className="h-2 w-3/4 rounded-pill bg-surface-3" />
          <div className="h-2 w-1/2 rounded-pill bg-surface-3" />
          <div className="h-10 rounded-md bg-surface" />
          <div className="h-10 rounded-md bg-surface" />
        </div>
      </div>
      <figcaption className={cx('mt-1.5 text-center text-xs', on ? 'text-text' : 'text-muted')}>
        {t(`console.banner_app_${app}` as MessageKey)}
        {!on && <span className="block text-xs">{t('console.banner_not_here')}</span>}
      </figcaption>
    </figure>
  );
}

// ───────────────────────── dialogs ─────────────────────────

/** The customer app's refusal, as the phone shows it (light island). */
function RefusalPhone({ message }: { message: string }) {
  return (
    <div
      data-theme="light"
      className="overflow-hidden rounded-[22px] border-[6px] border-inverse bg-canvas text-text shadow-card"
    >
      <div className="flex items-center justify-between bg-surface px-3 py-2">
        <span className="text-xs font-bold">{t('console.banner_app_title_customer')}</span>
        <span className="h-4 w-4 rounded-pill bg-accent" />
      </div>
      <div className="space-y-2 p-3">
        <div className="h-2.5 w-2/3 rounded-pill bg-surface-3" />
        <div className="h-14 rounded-md bg-surface" />
      </div>
      <div className="mx-2 mb-2 rounded-xl bg-surface p-3 shadow-pop">
        <p className="flex items-start gap-2 text-[13px] font-semibold leading-5">
          <IconStop size={16} className="mt-0.5 shrink-0 text-bad" />
          <span>{message}</span>
        </p>
        <span className="mt-3 flex h-8 items-center justify-center rounded-md bg-accent text-xs font-semibold text-on-accent">
          {t('console.ctl_phone_ok')}
        </span>
      </div>
    </div>
  );
}

export function SwitchDialog({
  target,
  onClose,
}: {
  target: SwitchTarget | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { reason: useId(), message: useId(), expiry: useId() };
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryKey>('1h');
  const [hold, setHold] = useState(false);
  const save = useMutation(
    trpc.ops.controls.setSwitch.mutationOptions({
      onSuccess: (s) => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.view.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({
          title: s.active
            ? t('console.ctl_toast_stopped', { name: s.label_ar })
            : t('console.ctl_toast_restored', { name: s.label_ar }),
          tone: 'ok',
        });
        onClose();
      },
    }),
  );
  const restore = target?.restore ?? false;
  const until = target && !restore ? expiryAt(expiry, new Date()) : undefined;
  const fallback = target ? defaultRefusal(target.scope, target.label, until ?? null) : '';
  useEffect(() => {
    if (!target) return;
    setReason('');
    setEdited(false);
    setExpiry('1h');
    setHold(false);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new target only
  }, [target]);
  // The message follows the chosen end time until the person writes their own.
  useEffect(() => {
    if (!edited) setMessage(fallback);
  }, [fallback, edited]);
  const valid = reason.trim().length >= 3 && (restore || message.trim().length >= 3);
  const name = target
    ? target.scope === 'zone' && target.vertical
      ? t('console.ctl_zone_service', {
          service: verticalLabel(target.vertical),
          zone: target.label,
        })
      : target.label
    : '';
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!target || !valid) return;
    save.mutate({
      cityId: CITY_ID,
      scope: target.scope,
      key: target.key,
      ...(target.scope === 'zone' && target.vertical ? { vertical: target.vertical } : {}),
      active: !restore,
      holdDispatch: !restore && hold,
      reason: reason.trim(),
      ...(!restore ? { message_ar: message.trim() } : {}),
      ...(!restore && until ? { expiresAt: until } : {}),
    });
  };
  const canHold = target?.scope === 'vertical' || target?.scope === 'zone';
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      labelledBy="switch-title"
      width="lg"
      title={
        restore ? t('console.ctl_dialog_restore', { name }) : t('console.ctl_dialog_stop', { name })
      }
      description={
        target
          ? restore
            ? t('console.ctl_dialog_restore_hint')
            : t(`console.ctl_dialog_hint_${target.scope}` as MessageKey)
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant={restore ? 'primary' : 'danger'}
            needsNet
            disabled={!valid}
            loading={save.isPending}
            onClick={() => submit()}
            icon={restore ? undefined : <IconStop size={16} />}
          >
            {restore
              ? t('console.ctl_restore_name', { name })
              : t('console.ctl_stop_name', { name })}
          </Button>
        </>
      }
    >
      {target && (
        <form
          onSubmit={submit}
          className={cx('grid gap-5 pb-1', !restore && 'md:grid-cols-[minmax(0,1fr)_14.5rem]')}
        >
          <div className="space-y-4">
            {restore && target.current && (
              <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm">
                <p>
                  {t('console.ctl_stopped_by', {
                    name: target.current.setByName ?? t('console.someone'),
                    time: formatClock(target.current.setAt),
                  })}
                  : <span className="font-semibold">{target.current.reason}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">{switchUntil(target.current)}</p>
              </div>
            )}
            <Field
              label={t('console.ctl_reason')}
              htmlFor={ids.reason}
              hint={t('console.ctl_reason_hint')}
            >
              <Input
                id={ids.reason}
                required
                minLength={3}
                maxLength={300}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  restore
                    ? t('console.ctl_restore_reason_placeholder')
                    : t('console.ctl_reason_placeholder')
                }
              />
            </Field>
            {!restore && (
              <>
                <Field
                  label={t('console.ctl_expiry')}
                  htmlFor={ids.expiry}
                  hint={
                    until
                      ? t('console.ctl_back_at', { time: formatClock(until) })
                      : t('console.ctl_expiry_none_hint')
                  }
                >
                  <Select
                    id={ids.expiry}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value as ExpiryKey)}
                  >
                    {EXPIRY_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {t(`console.ctl_expiry_${k}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('console.ctl_customer_message')}
                  htmlFor={ids.message}
                  hint={edited ? t('console.ctl_message_own') : t('console.ctl_message_auto')}
                >
                  <Textarea
                    id={ids.message}
                    rows={2}
                    maxLength={200}
                    value={message}
                    onChange={(e) => {
                      setEdited(true);
                      setMessage(e.target.value);
                    }}
                  />
                </Field>
                {edited && (
                  <button
                    type="button"
                    className="-mt-2 text-xs text-accent-text underline-offset-4 hover:underline"
                    onClick={() => setEdited(false)}
                  >
                    {t('console.ctl_message_reset')}
                  </button>
                )}
                {canHold && (
                  <Checkbox
                    label={t('console.ctl_hold')}
                    hint={t('console.ctl_hold_hint')}
                    checked={hold}
                    onChange={setHold}
                  />
                )}
              </>
            )}
            <div role="status" className="min-h-[1.25rem] text-sm">
              {save.error && <p className="text-bad">{errorText(save.error)}</p>}
            </div>
          </div>
          {!restore && (
            <aside aria-label={t('console.ctl_customer_sees')}>
              <p className="mb-2 text-dense font-medium">{t('console.ctl_customer_sees')}</p>
              <RefusalPhone message={message.trim() || fallback} />
            </aside>
          )}
        </form>
      )}
    </Dialog>
  );
}

function CapacityDialog({ zone, onClose }: { zone: ZoneCapacityView | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { max: useId(), eta: useId() };
  const [max, setMax] = useState('');
  const [mode, setMode] = useState<'refuse' | 'queue'>('refuse');
  const [eta, setEta] = useState(15);
  const save = useMutation(
    trpc.ops.controls.setCapacity.mutationOptions({
      onSuccess: (z) => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.view.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({
          title: z.maxActive
            ? t('console.ctl_toast_cap', { name: z.name_ar, n: z.maxActive })
            : t('console.ctl_toast_cap_off', { name: z.name_ar }),
          tone: 'ok',
        });
        onClose();
      },
    }),
  );
  useEffect(() => {
    if (!zone) return;
    setMax(zone.maxActive ? String(zone.maxActive) : '');
    setMode(zone.mode);
    setEta(zone.etaMin);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new zone only
  }, [zone]);
  const n = max.trim() === '' ? null : Number(max);
  const valid = n === null || (Number.isInteger(n) && n >= 1 && n <= 500);
  const submit = (e?: FormEvent, value: number | null = n) => {
    e?.preventDefault();
    if (!zone || !valid) return;
    save.mutate({ cityId: CITY_ID, zoneKey: zone.zoneKey, maxActive: value, mode, etaMin: eta });
  };
  const pct = zone && n ? gaugePct({ maxActive: n, active: zone.active }) : 0;
  return (
    <Dialog
      open={zone !== null}
      onClose={onClose}
      labelledBy="cap-title"
      title={zone ? t('console.ctl_cap_title', { name: zone.name_ar }) : ''}
      description={zone ? t('console.ctl_cap_now', { n: zone.active }) : undefined}
      footer={
        <>
          {zone?.maxActive !== null && zone?.maxActive !== undefined && (
            <Button
              variant="danger-soft"
              className="me-auto"
              needsNet
              disabled={save.isPending}
              onClick={() => submit(undefined, null)}
            >
              {t('console.ctl_cap_remove')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            needsNet
            disabled={!valid}
            loading={save.isPending}
            onClick={() => submit()}
          >
            {n === null ? t('console.ctl_cap_save_none') : t('console.ctl_cap_save_n', { n })}
          </Button>
        </>
      }
    >
      {zone && (
        <form onSubmit={submit} className="space-y-4 pb-1">
          <Field
            label={t('console.ctl_cap_max')}
            htmlFor={ids.max}
            hint={
              n !== null && valid
                ? t('console.ctl_cap_now_pct', { pct })
                : t('console.ctl_cap_max_hint')
            }
            error={valid ? undefined : t('console.ctl_cap_invalid')}
          >
            <span className="block w-36">
              <Input
                id={ids.max}
                dir="ltr"
                inputMode="numeric"
                autoFocus
                className="num text-center text-base font-semibold"
                value={max}
                onChange={(e) => setMax(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="—"
                aria-invalid={!valid}
              />
            </span>
          </Field>
          <div className="space-y-1.5">
            <p className="text-dense font-medium">{t('console.ctl_cap_mode')}</p>
            <Segmented<'refuse' | 'queue'>
              label={t('console.ctl_cap_mode')}
              value={mode}
              onChange={setMode}
              options={(['refuse', 'queue'] as const).map((m) => ({
                value: m,
                label: t(`console.ctl_cap_mode_${m}` as MessageKey),
              }))}
            />
          </div>
          <Field label={t('console.ctl_cap_eta')} htmlFor={ids.eta} className="w-48">
            <Select id={ids.eta} value={eta} onChange={(e) => setEta(Number(e.target.value))}>
              {ETA_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {t('console.wait_min', { n: m })}
                </option>
              ))}
            </Select>
          </Field>
          <Quote label={t('console.ctl_cap_preview')}>{throttlePreview(eta, mode)}</Quote>
          <div role="status" className="min-h-[1.25rem] text-sm">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Quote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm">
      <p className="mb-0.5 text-xs text-muted">{label}</p>
      <p className="font-medium">«{children}»</p>
    </div>
  );
}
