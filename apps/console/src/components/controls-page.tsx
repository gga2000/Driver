'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditEntry, BannerAudience, BannerSeverity, ControlsView, KillScope, KillSwitchView, SystemBannerView, Vertical, ZoneCapacityView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BANNER_HOURS,
  bannerTone,
  defaultRefusal,
  ETA_CHOICES,
  EXPIRY_KEYS,
  expiryAt,
  gaugePct,
  gaugeTone,
  sortZones,
  throttlePreview,
  type ExpiryKey,
} from '@/lib/control-room';
import { formatClock, formatDayClock } from '@/lib/format';
import { tierLabel, verticalLabel } from '@/lib/labels';
import { CITY_ID, queryRetry, SLOW_POLL_MS } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { DispatchModes } from './dispatch-modes';
import { Card, Chip, dangerBtn, ghostBtn, inputCls, LiveBadge, NeedLogin, PageHeader, primaryBtn, QueryError, Stat } from './ui';

/** What a switch dialog acts on. */
export interface SwitchTarget {
  scope: KillScope;
  key: string;
  label: string;
  /** Switching it back on (the current one is active). */
  restore: boolean;
  vertical?: Vertical | null;
}

const SEVERITIES: readonly BannerSeverity[] = ['info', 'warning', 'critical'];
const AUDIENCES: readonly BannerAudience[] = ['customer', 'partner', 'merchant'];

export function ControlsPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const view = useQuery(trpc.ops.controls.view.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: SLOW_POLL_MS, retry: queryRetry }));
  const audit = useQuery(trpc.ops.controls.audit.queryOptions({ cityId: CITY_ID, limit: 60 }, { enabled: signedIn, refetchInterval: 15_000, retry: queryRetry }));
  const banners = useQuery(trpc.system.banners.queryOptions(undefined, { enabled: signedIn, refetchInterval: 15_000, retry: queryRetry }));
  const [target, setTarget] = useState<SwitchTarget | null>(null);
  const [zone, setZone] = useState<ZoneCapacityView | null>(null);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.ctl_title')} subtitle={t('console.ctl_subtitle')} />
        <NeedLogin />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.ctl_title')} subtitle={t('console.ctl_subtitle')}>
        <LiveBadge seconds={SLOW_POLL_MS / 1000} updatedAt={view.dataUpdatedAt} fetching={view.isFetching} />
      </PageHeader>
      {view.error && <QueryError error={view.error} onRetry={() => void view.refetch()} />}
      {view.data && (
        <ControlsBoard
          view={view.data}
          audit={audit.data ?? []}
          banners={banners.data ?? []}
          canSwitch={hasAny(roles, ['admin', 'dispatcher'])}
          canBanner={roles.has('admin')}
          onSwitch={setTarget}
          onZone={setZone}
        />
      )}
      {hasAny(roles, ['admin', 'dispatcher']) && <DispatchModes />}
      <SwitchDialog target={target} onClose={() => setTarget(null)} />
      <CapacityDialog zone={zone} onClose={() => setZone(null)} />
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
}: {
  view: ControlsView;
  audit: AuditEntry[];
  banners: SystemBannerView[];
  canSwitch: boolean;
  canBanner: boolean;
  onSwitch: (t: SwitchTarget) => void;
  onZone: (z: ZoneCapacityView) => void;
}) {
  const on = view.switches.filter((s) => s.active);
  const zones = useMemo(() => sortZones(view.zones), [view.zones]);
  // Capped, switched-off or busy zones get a gauge card; the quiet rest is a compact list.
  const watched = zones.filter((z) => z.maxActive !== null || z.state !== 'ok' || z.active >= 3);
  const rest = zones.filter((z) => !watched.includes(z));
  const controlLog = audit.filter((a) => a.subjectKind === 'kill_switch' || a.subjectKind === 'capacity' || a.subjectKind === 'banner');
  const throttled = view.zones.filter((z) => z.maxActive !== null);
  const pressed = view.zones.filter((z) => z.state === 'full' || z.state === 'busy');
  const liveBanner = banners.find((b) => b.active);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('console.ctl_stat_switches')} value={on.length} tone={on.length > 0 ? 'bad' : 'ok'} hint={on.length > 0 ? on.map((s) => s.label_ar).slice(0, 3).join('، ') : t('console.ctl_all_running')} />
        <Stat label={t('console.ctl_stat_active_orders')} value={view.activeOrders} hint={t('console.ctl_stat_throttled', { n: throttled.length })} />
        <Stat label={t('console.ctl_stat_pressed')} value={pressed.length} tone={pressed.some((z) => z.state === 'full') ? 'bad' : pressed.length ? 'accent' : 'default'} hint={pressed.map((z) => z.name_ar).slice(0, 3).join('، ') || t('console.ctl_no_pressure')} />
        <Stat
          label={t('console.ctl_stat_banner')}
          value={liveBanner ? t(`console.banner_sev_${liveBanner.severity}` as MessageKey) : t('console.ctl_banner_none')}
          tone={liveBanner?.severity === 'critical' ? 'bad' : liveBanner ? 'accent' : 'default'}
          hint={liveBanner ? t('console.ctl_banner_until', { time: formatClock(liveBanner.expiresAt) }) : undefined}
        />
      </dl>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t('console.ctl_switches')} className="xl:col-span-2" actions={!canSwitch ? <Chip>{t('console.ctl_read_only')}</Chip> : undefined}>
          <p className="mb-4 text-sm text-muted">{t('console.ctl_switches_hint')}</p>
          <TileGroup title={t('console.ctl_group_verticals')}>
            {view.verticals.map((v) => (
              <SwitchTile key={v.key} label={verticalLabel(v.key)} killed={v.killed} disabled={!canSwitch} onClick={() => onSwitch({ scope: 'vertical', key: v.key, label: v.label_ar, restore: v.killed })} />
            ))}
          </TileGroup>
          <TileGroup title={t('console.ctl_group_corridors')} wide>
            {view.corridors.map((c) => (
              <SwitchTile key={c.key} label={c.label_ar} killed={c.killed} disabled={!canSwitch} onClick={() => onSwitch({ scope: 'corridor', key: c.key, label: c.label_ar, restore: c.killed })} />
            ))}
          </TileGroup>
          <TileGroup title={t('console.ctl_group_restaurants')}>
            {view.restaurants.length === 0 && <p className="text-sm text-faint">{t('console.ctl_no_restaurants')}</p>}
            {view.restaurants.map((r) => (
              <SwitchTile key={r.key} label={r.label_ar} killed={r.killed} disabled={!canSwitch} onClick={() => onSwitch({ scope: 'restaurant', key: r.key, label: r.label_ar, restore: r.killed })} />
            ))}
          </TileGroup>
        </Card>

        <Card title={t('console.ctl_on_now')} tone={on.length > 0 ? 'bad' : 'default'}>
          {on.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-ok">{t('console.ctl_all_running')}</p>
          ) : (
            <ul className="space-y-2">
              {on.map((s) => (
                <ActiveSwitch key={s.id} s={s} canSwitch={canSwitch} onRestore={() => onSwitch({ scope: s.scope, key: s.key, label: s.label_ar, restore: true, vertical: s.vertical })} />
              ))}
            </ul>
          )}
          {view.switches.some((s) => !s.active) && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-semibold text-muted">{t('console.ctl_recent_restored')}</h3>
              <ul className="space-y-1 text-xs text-muted">
                {view.switches
                  .filter((s) => !s.active)
                  .slice(0, 5)
                  .map((s) => (
                    <li key={s.id} className="flex justify-between gap-2">
                      <span className="truncate">{s.label_ar}</span>
                      <span className="shrink-0">{formatDayClock(s.setAt)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card title={t('console.ctl_zones')} actions={<span className="text-xs text-muted">{t('console.ctl_zones_hint')}</span>}>
        {watched.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {watched.map((z) => (
              <ZoneGauge key={z.zoneKey} z={z} canEdit={canSwitch} onEdit={() => onZone(z)} onKill={() => onSwitch({ scope: 'zone', key: z.zoneKey, label: z.name_ar, restore: z.killed })} />
            ))}
          </ul>
        )}
        {rest.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-xs font-semibold text-muted">{t('console.ctl_zones_rest', { n: rest.length })}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {rest.map((z) => (
                <li key={z.zoneKey}>
                  <button
                    type="button"
                    disabled={!canSwitch}
                    onClick={() => onZone(z)}
                    title={t('console.ctl_edit_cap')}
                    className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface-2/50 px-3 py-1 text-xs hover:border-line-strong disabled:cursor-default"
                  >
                    {z.name_ar}
                    <span className={`tabular-nums ${z.active ? 'text-text' : 'text-faint'}`}>{z.active}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <BannerCard className="xl:col-span-2" banners={banners} canBanner={canBanner} />
        <AuditCard entries={controlLog} />
      </div>
    </div>
  );
}

function TileGroup({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold text-muted">{title}</h3>
      <div className={`grid gap-2 ${wide ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>{children}</div>
    </section>
  );
}

function SwitchTile({ label, killed, disabled, onClick }: { label: string; killed: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={killed}
      title={`${label} · ${killed ? t('console.ctl_tile_restore') : t('console.ctl_tile_stop')}`}
      className={`flex min-h-[3.25rem] items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        killed ? 'border-bad/40 bg-bad-tint hover:bg-bad-tint' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text'
      }`}
    >
      <span className="min-w-0 truncate font-semibold">{label}</span>
      <span className={`flex shrink-0 items-center gap-1.5 text-xs ${killed ? 'text-bad' : 'text-ok'}`}>
        <span aria-hidden className={`inline-block h-2 w-2 rounded-pill ${killed ? 'bg-bad' : 'bg-ok'}`} />
        {killed ? t('console.ctl_state_off') : t('console.ctl_state_on')}
      </span>
    </button>
  );
}

function ActiveSwitch({ s, canSwitch, onRestore }: { s: KillSwitchView; canSwitch: boolean; onRestore: () => void }) {
  return (
    <li className="rounded-lg border border-bad/40 bg-bad-tint p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {s.label_ar}
            <Chip tone="bad">{t(`console.ctl_scope_${s.scope}` as MessageKey)}</Chip>
            {s.holdDispatch && <Chip tone="warn">{t('console.ctl_hold_chip')}</Chip>}
          </p>
          <p className="mt-1 text-sm text-muted">{s.reason}</p>
          {s.message_ar && <p className="mt-1 text-xs text-faint">«{s.message_ar}»</p>}
          <p className="mt-1 text-xs text-faint">
            {t('console.ctl_set_by', { name: s.setByName ?? t('console.someone'), time: formatClock(s.setAt) })}
            {s.expiresAt ? ` · ${t('console.ctl_until', { time: formatClock(s.expiresAt) })}` : ''}
          </p>
        </div>
        {canSwitch && (
          <button type="button" className={ghostBtn} onClick={onRestore}>
            {t('console.ctl_restore')}
          </button>
        )}
      </div>
    </li>
  );
}

function ZoneGauge({ z, canEdit, onEdit, onKill }: { z: ZoneCapacityView; canEdit: boolean; onEdit: () => void; onKill: () => void }) {
  const tone = gaugeTone(z.state);
  const pct = gaugePct(z);
  return (
    <li className={`flex flex-col rounded-lg border p-3 ${z.state === 'full' ? 'border-bad/40 bg-bad-tint' : z.state === 'off' ? 'border-line bg-surface-2/40' : 'border-line bg-surface-2/60'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold" title={z.name_ar}>
          {z.name_ar}
        </p>
        <Chip tone={tone.chip}>{t(`console.zone_state_${z.state}` as MessageKey)}</Chip>
      </div>
      <p className="mt-0.5 text-xs text-faint">{tierLabel(z.tier as never)}</p>
      <p className="mt-2 font-display text-xl font-bold tabular-nums">
        {z.active}
        <span className="text-sm font-normal text-muted"> / {z.maxActive ?? '∞'}</span>
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={z.maxActive ?? 0} aria-valuenow={z.active} aria-label={z.name_ar}>
        <div className={`h-full ${tone.bar}`} style={{ width: `${z.maxActive ? Math.max(pct, 4) : 0}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-faint">{z.maxActive ? t(`console.ctl_mode_${z.mode}` as MessageKey, { min: z.etaMin }) : t('console.ctl_no_cap')}</p>
      {canEdit && (
        <div className="mt-2 flex gap-1">
          <button type="button" className={`${ghostBtn} flex-1 px-2 py-1 text-xs`} onClick={onEdit}>
            {t('console.ctl_edit_cap')}
          </button>
          <button type="button" className={`${ghostBtn} px-2 py-1 text-xs ${z.killed ? 'text-ok' : 'text-bad'}`} onClick={onKill}>
            {z.killed ? t('console.ctl_restore') : t('console.ctl_stop')}
          </button>
        </div>
      )}
    </li>
  );
}

function AuditCard({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card title={t('console.ctl_audit')}>
      {entries.length === 0 ? (
        <p className="text-sm text-faint">{t('console.ctl_audit_empty')}</p>
      ) : (
        <ol className="max-h-[26rem] space-y-2 overflow-y-auto">
          {entries.map((a) => (
            <li key={a.id} className="border-b border-line/60 pb-2 text-sm last:border-b-0">
              <p>{a.summary_ar}</p>
              <p className="mt-0.5 text-xs text-faint">
                {a.actorName ?? t('console.someone')} · {formatDayClock(a.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ───────────────────────── banner ─────────────────────────

function BannerCard({ banners, canBanner, className = '' }: { banners: SystemBannerView[]; canBanner: boolean; className?: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ids = { msg: useId(), hours: useId() };
  const [severity, setSeverity] = useState<BannerSeverity>('warning');
  const [audiences, setAudiences] = useState<BannerAudience[]>(['customer', 'partner', 'merchant']);
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState(2);
  const refresh = { onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.system.banners.queryKey() }) };
  const set = useMutation(trpc.system.setBanner.mutationOptions({ ...refresh, onSuccess: () => (setMessage(''), refresh.onSuccess()) }));
  const clear = useMutation(trpc.system.clearBanner.mutationOptions(refresh));
  const valid = message.trim().length >= 3 && audiences.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    set.mutate({ cityId: CITY_ID, severity, audiences, message_ar: message.trim(), expiresAt: new Date(Date.now() + hours * 3_600_000) });
  };
  const toggle = (a: BannerAudience) => setAudiences((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  return (
    <Card title={t('console.banner_title')} className={className} actions={!canBanner ? <Chip>{t('console.banner_admin_only')}</Chip> : undefined}>
      <p className="mb-3 text-sm text-muted">{t('console.banner_hint')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={!canBanner} className="space-y-3 disabled:opacity-60">
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('console.banner_severity')}>
              {SEVERITIES.map((s) => (
                <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)} className={ghostBtn}>
                  {t(`console.banner_sev_${s}` as MessageKey)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {AUDIENCES.map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={audiences.includes(a)} onChange={() => toggle(a)} />
                  {t(`console.banner_app_${a}` as MessageKey)}
                </label>
              ))}
            </div>
            <div>
              <label htmlFor={ids.msg} className="mb-1.5 block text-sm text-muted">
                {t('console.banner_message')}
              </label>
              <textarea id={ids.msg} rows={2} maxLength={200} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('console.banner_placeholder')} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={ids.hours} className="mb-1.5 block text-sm text-muted">
                  {t('console.banner_for')}
                </label>
                <select id={ids.hours} className={inputCls} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {BANNER_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {t('console.banner_hours', { n: h })}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={primaryBtn} disabled={!valid || set.isPending}>
                {set.isPending ? t('status.loading') : t('console.banner_send')}
              </button>
            </div>
            {set.error && <p className="text-sm text-bad">{errorText(set.error)}</p>}
          </fieldset>
        </form>
        <div>
          <p className="mb-2 text-xs text-muted">{t('console.banner_preview')}</p>
          <BannerPreview severity={severity} message={message.trim() || t('console.banner_placeholder')} />
          <ul className="mt-4 space-y-2">
            {banners.slice(0, 5).map((b) => (
              <li key={b.id} className={`rounded-lg border px-3 py-2 text-sm ${b.active ? 'border-line bg-surface-2/60' : 'border-line/60 text-muted'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0">
                    <Chip tone={bannerTone(b.severity)}>{t(`console.banner_sev_${b.severity}` as MessageKey)}</Chip> {b.message_ar}
                  </p>
                  {b.active && canBanner && (
                    <button type="button" className={`${ghostBtn} shrink-0 px-2 py-1 text-xs`} disabled={clear.isPending} onClick={() => clear.mutate({ bannerId: b.id })}>
                      {t('console.banner_clear')}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-faint">
                  {b.audiences.map((a) => t(`console.banner_app_${a}` as MessageKey)).join('، ')} · {b.active ? t('console.ctl_until', { time: formatClock(b.expiresAt) }) : b.clearedAt ? t('console.banner_cleared') : t('console.banner_ended')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** How the strip looks on a phone (the apps render it with `StatusBanner` from @driver/ui). */
export function BannerPreview({ severity, message }: { severity: BannerSeverity; message: string }) {
  // The apps' theme tints (dangerTint / warningTint / infoTint) on the light phone surface: a light
  // island, whatever the Console's own theme.
  const cls = severity === 'critical' ? 'border-bad/40 bg-bad-tint text-bad' : severity === 'warning' ? 'border-warn/40 bg-warn-tint text-warn' : 'border-info/40 bg-info-tint text-info';
  return (
    <div data-theme="light" className="overflow-hidden rounded-xl border border-line bg-canvas text-text shadow-card" aria-hidden>
      <div className={`flex items-center gap-3 border-b px-3 py-2 ${cls}`}>
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-current text-xs">
          <span className="text-surface">!</span>
        </span>
        <span className="text-sm font-semibold">{message}</span>
      </div>
      <div className="space-y-2 p-3">
        <div className="h-3 w-2/3 rounded-pill bg-surface-3" />
        <div className="h-3 w-1/2 rounded-pill bg-surface-3" />
        <div className="h-16 rounded-lg bg-surface-2" />
      </div>
    </div>
  );
}

// ───────────────────────── dialogs ─────────────────────────

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

const ZONE_VERTICALS: readonly Vertical[] = ['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk'];

export function SwitchDialog({ target, onClose }: { target: SwitchTarget | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ref = useDialog(target !== null);
  const ids = { reason: useId(), message: useId(), expiry: useId(), vertical: useId(), hold: useId() };
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState<ExpiryKey>('none');
  const [hold, setHold] = useState(false);
  const [vertical, setVertical] = useState<Vertical | ''>('');
  const save = useMutation(
    trpc.ops.controls.setSwitch.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.view.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        ref.current?.close();
      },
    }),
  );
  useEffect(() => {
    if (!target) return;
    setReason('');
    setMessage('');
    setExpiry('none');
    setHold(false);
    setVertical(target.vertical ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new target only
  }, [target]);
  const restore = target?.restore ?? false;
  const valid = reason.trim().length >= 3;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !valid) return;
    const at = expiryAt(expiry, new Date());
    save.mutate({
      cityId: CITY_ID,
      scope: target.scope,
      key: target.key,
      ...(target.scope === 'zone' && vertical ? { vertical } : {}),
      active: !restore,
      holdDispatch: !restore && hold,
      reason: reason.trim(),
      ...(!restore && message.trim() ? { message_ar: message.trim() } : {}),
      ...(!restore && at ? { expiresAt: at } : {}),
    });
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="switch-title" className="w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-0 text-text shadow-overlay">
      {target && (
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <h2 id="switch-title" className="font-display text-lg font-semibold">
              {restore ? t('console.ctl_dialog_restore', { name: target.label }) : t('console.ctl_dialog_stop', { name: target.label })}
            </h2>
            <p className="mt-1 text-sm text-muted">{restore ? t('console.ctl_dialog_restore_hint') : t(`console.ctl_dialog_hint_${target.scope}` as MessageKey)}</p>
          </div>
          {!restore && target.scope === 'zone' && (
            <div>
              <label htmlFor={ids.vertical} className="mb-1.5 block text-sm text-muted">
                {t('console.ctl_zone_vertical')}
              </label>
              <select id={ids.vertical} className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value as Vertical | '')}>
                <option value="">{t('console.ctl_zone_all')}</option>
                {ZONE_VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {verticalLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={ids.reason} className="mb-1.5 block text-sm text-muted">
              {t('console.ctl_reason')}
            </label>
            <input id={ids.reason} required minLength={3} maxLength={300} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('console.ctl_reason_placeholder')} />
          </div>
          {!restore && (
            <>
              <div>
                <label htmlFor={ids.message} className="mb-1.5 block text-sm text-muted">
                  {t('console.ctl_customer_message')}
                </label>
                <textarea id={ids.message} rows={2} maxLength={200} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={defaultRefusal(target.scope, target.label)} />
                <p className="mt-1 text-xs text-faint">{t('console.ctl_customer_message_hint')}</p>
              </div>
              <div className="flex flex-wrap gap-4">
                <div>
                  <label htmlFor={ids.expiry} className="mb-1.5 block text-sm text-muted">
                    {t('console.ctl_expiry')}
                  </label>
                  <select id={ids.expiry} className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryKey)}>
                    {EXPIRY_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {t(`console.ctl_expiry_${k}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </div>
                {(target.scope === 'vertical' || target.scope === 'zone') && (
                  <label htmlFor={ids.hold} className="flex max-w-xs items-start gap-3 self-end text-sm">
                    <input id={ids.hold} type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--c-accent))]" checked={hold} onChange={(e) => setHold(e.target.checked)} />
                    {t('console.ctl_hold')}
                  </label>
                )}
              </div>
            </>
          )}
          <div role="status" className="min-h-[1.25rem] text-sm">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={() => ref.current?.close()}>
              {t('console.cancel')}
            </button>
            <button type="submit" className={restore ? primaryBtn : dangerBtn} disabled={!valid || save.isPending}>
              {save.isPending ? t('status.loading') : restore ? t('console.ctl_restore') : t('console.ctl_stop_now')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function CapacityDialog({ zone, onClose }: { zone: ZoneCapacityView | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ref = useDialog(zone !== null);
  const ids = { max: useId(), eta: useId() };
  const [max, setMax] = useState('');
  const [mode, setMode] = useState<'refuse' | 'queue'>('refuse');
  const [eta, setEta] = useState(15);
  const save = useMutation(
    trpc.ops.controls.setCapacity.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.view.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        ref.current?.close();
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!zone || !valid) return;
    save.mutate({ cityId: CITY_ID, zoneKey: zone.zoneKey, maxActive: n, mode, etaMin: eta });
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="cap-title" className="w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-0 text-text shadow-overlay">
      {zone && (
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <h2 id="cap-title" className="font-display text-lg font-semibold">
              {t('console.ctl_cap_title', { name: zone.name_ar })}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('console.ctl_cap_now', { n: zone.active })}</p>
          </div>
          <div>
            <label htmlFor={ids.max} className="mb-1.5 block text-sm text-muted">
              {t('console.ctl_cap_max')}
            </label>
            <input id={ids.max} dir="ltr" inputMode="numeric" className={inputCls} value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d]/g, ''))} placeholder="∞" aria-invalid={!valid} />
            <p className="mt-1 text-xs text-faint">{t('console.ctl_cap_max_hint')}</p>
          </div>
          <fieldset className="flex flex-wrap gap-1">
            <legend className="mb-1.5 text-sm text-muted">{t('console.ctl_cap_mode')}</legend>
            {(['refuse', 'queue'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={ghostBtn}>
                {t(`console.ctl_cap_mode_${m}` as MessageKey)}
              </button>
            ))}
          </fieldset>
          <div>
            <label htmlFor={ids.eta} className="mb-1.5 block text-sm text-muted">
              {t('console.ctl_cap_eta')}
            </label>
            <select id={ids.eta} className={inputCls} value={eta} onChange={(e) => setEta(Number(e.target.value))}>
              {ETA_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {t('console.wait_min', { n: m })}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-sm">
            <p className="mb-1 text-xs text-muted">{t('console.ctl_cap_preview')}</p>
            <p>«{throttlePreview(eta, mode)}»</p>
          </div>
          <div role="status" className="min-h-[1.25rem] text-sm">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={() => ref.current?.close()}>
              {t('console.cancel')}
            </button>
            <button type="submit" className={primaryBtn} disabled={!valid || save.isPending}>
              {save.isPending ? t('status.loading') : t('console.ctl_cap_save')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

