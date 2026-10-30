'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { FOOD_DOORS, type EarlyCloseReason, type FoodDoor, type MerchantSetupView, type SetupStep, type StoreStatusView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useRef, useState, type ChangeEvent } from 'react';
import { fileUrl } from '@/lib/control-room';
import { queryRetry } from '@/lib/live';
import { useConsoleNetwork } from '@/lib/network';
import { photoProblem, uploadPhoto } from '@/lib/pickup-spots';
import { STEP_PLACE } from '@/lib/store-setup';
import { API_URL, useTRPC, useTRPCClient } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, Field, IconCheck, IconLock, IconPlus, Input, Meter, QueryError, Select, Skeleton, Spinner } from '../ui';
import { useStoreWrite } from './store-write';
import type { StoreTab } from './store-workspace';

const STEP_KEY: Record<SetupStep, `console.stores.step_${SetupStep}`> = {
  kind: 'console.stores.step_kind',
  menu: 'console.stores.step_menu',
  photos: 'console.stores.step_photos',
  hours: 'console.stores.step_hours',
  money: 'console.stores.step_money',
  pickup: 'console.stores.step_pickup',
  counter: 'console.stores.step_counter',
};
const DOOR_KEY: Record<FoodDoor, `console.stores.door_${FoodDoor}`> = {
  meal: 'console.stores.door_meal',
  cafe: 'console.stores.door_cafe',
  cold: 'console.stores.door_cold',
  sweet: 'console.stores.door_sweet',
};
const TAB_FOR: Partial<Record<(typeof STEP_PLACE)[SetupStep], StoreTab>> = { menu: 'menu', hours: 'hours', pickup: 'pickup' };

/**
 * «المحل»: a shop in setup shows the owner's seven steps as a visit list (what is done, where the
 * team does the rest, which two stay the owner's) ending in «افتح المحل للزباين»; an open shop
 * shows its switches (open, close, a short pause, busy) with the owner's very rules.
 */
export function StoreShop({ storeId, canEdit, onGo }: { storeId: string; canEdit: boolean; onGo: (tab: StoreTab) => void }) {
  const trpc = useTRPC();
  const scope = { merchantOrgId: storeId };
  const setup = useQuery(trpc.ops.stores.setup.queryOptions(scope, { retry: queryRetry }));
  const status = useQuery(trpc.ops.stores.status.queryOptions(scope, { retry: queryRetry }));
  if (setup.error) return <QueryError error={setup.error} onRetry={() => void setup.refetch()} />;
  if (!setup.data || !status.data) {
    return (
      <Card>
        <div className="space-y-3" aria-busy>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }
  const inSetup = setup.data.active && !setup.data.live;
  return (
    <div className="space-y-4">
      {inSetup ? <Visit view={setup.data} storeId={storeId} canEdit={canEdit} onGo={onGo} /> : <Switches status={status.data} storeId={storeId} canEdit={canEdit} />}
      {inSetup ? <ShopPhoto view={setup.data} storeId={storeId} canEdit={canEdit} /> : null}
    </div>
  );
}

// ───────────────────────── a shop in setup: the visit ─────────────────────────

function Visit({ view, storeId, canEdit, onGo }: { view: MerchantSetupView; storeId: string; canEdit: boolean; onGo: (tab: StoreTab) => void }) {
  const p = view.progress;
  const [opening, setOpening] = useState(false);
  return (
    <Card title={t('console.stores.visit_title')} hint={t('console.stores.visit_hint')}>
      <Meter value={p.done} max={p.total} tone={p.left === 0 ? 'ok' : 'warn'} label={t('console.stores.visit_meter', { done: p.done, total: p.total })} />
      <ol className="mt-4 divide-y divide-line/70">
        {p.steps.map((s, i) => {
          const place = STEP_PLACE[s.key];
          const tab = TAB_FOR[place];
          return (
            <li key={s.key} className="flex min-h-14 flex-wrap items-center gap-3 py-2" data-testid={`step-${s.key}`}>
              <span
                aria-hidden
                className={cx('num inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-dense font-semibold', s.done ? 'bg-ok-tint text-ok' : 'bg-surface-3 text-muted')}
              >
                {s.done ? <IconCheck size={16} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm', s.done ? 'text-muted' : 'font-medium text-text')}>{t(STEP_KEY[s.key])}</span>
                <span className="block text-xs text-muted">{stepLine(s.key, view, s.done)}</span>
              </span>
              {s.done ? (
                <Chip size="sm" tone="done">
                  {t('console.stores.step_done')}
                </Chip>
              ) : place === 'owner' ? (
                <Chip size="sm" tone="neutral">
                  <IconLock size={12} />
                  {t('console.stores.step_owner')}
                </Chip>
              ) : place === 'kind' ? null : tab ? (
                <Button size="sm" variant="secondary" onClick={() => onGo(tab)}>
                  {t('console.stores.step_go')}
                </Button>
              ) : null}
              {place === 'kind' && !s.done ? <Kinds view={view} storeId={storeId} canEdit={canEdit} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[52ch] text-xs text-muted">{p.left === 0 ? t('console.stores.open_ready') : t('console.stores.open_wait')}</p>
        <Button size="lg" variant="primary" disabled={!canEdit || p.left > 0} onClick={() => setOpening(true)}>
          {p.left > 0 ? t('console.stores.open_left', { n: p.left }) : t('console.stores.open_shop')}
        </Button>
      </div>
      {opening ? <GoLiveDialog storeId={storeId} name={view.name} onClose={() => setOpening(false)} /> : null}
    </Card>
  );
}

function stepLine(step: SetupStep, v: MerchantSetupView, done: boolean): string {
  switch (step) {
    case 'kind':
      return v.kinds.confirmed ? v.kinds.confirmed.map((d) => t(DOOR_KEY[d])).join('، ') : t('console.stores.line_kind');
    case 'menu':
      return t('console.stores.line_menu', { n: v.menu.items });
    case 'photos':
      return done ? t('console.stores.line_photos_done') : t('console.stores.line_photos', { n: v.menu.missingPhotos });
    case 'hours':
      return done ? t('console.stores.line_hours_done') : t('console.stores.line_hours');
    case 'money':
      return t('console.stores.line_money');
    case 'pickup':
      return done ? t('console.stores.line_pickup_done') : t('console.stores.line_pickup');
    case 'counter':
      return t('console.stores.line_counter');
  }
}

function Kinds({ view, storeId, canEdit }: { view: MerchantSetupView; storeId: string; canEdit: boolean }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [picked, setPicked] = useState<FoodDoor[]>(view.kinds.confirmed ?? view.kinds.suggested);
  const save = useMutation(trpc.ops.stores.confirmKinds.mutationOptions(write.handlers(t('console.stores.kinds_saved'))));
  return (
    <div className="flex w-full flex-wrap items-center gap-2 ps-11">
      {FOOD_DOORS.map((d) => {
        const on = picked.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            disabled={!canEdit}
            onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d) : [...p, d]))}
            className={cx('inline-flex h-11 items-center rounded-pill border px-4 text-sm transition-colors duration-fast', on ? 'border-accent bg-accent-tint font-semibold text-text' : 'border-line text-muted hover:border-line-strong')}
          >
            {t(DOOR_KEY[d])}
          </button>
        );
      })}
      <Button size="lg" variant="primary" disabled={!canEdit || picked.length === 0} loading={save.isPending} onClick={() => save.mutate({ merchantOrgId: storeId, kinds: picked as [FoodDoor, ...FoodDoor[]] })}>
        {t('console.stores.kinds_save')}
      </Button>
    </div>
  );
}

function GoLiveDialog({ storeId, name, onClose }: { storeId: string; name: string; onClose: () => void }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [why, setWhy] = useState('');
  const go = useMutation(trpc.ops.stores.goLive.mutationOptions({ ...write.handlers(t('console.stores.opened', { name })), onSettled: onClose }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('console.stores.open_title', { name })}
      description={t('console.stores.open_desc')}
      footer={
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('console.stores.cancel')}
          </Button>
          <Button size="lg" variant="primary" loading={go.isPending} onClick={() => go.mutate({ merchantOrgId: storeId, ...(why.trim() ? { why: why.trim() } : {}) })}>
            {t('console.stores.open_shop')}
          </Button>
        </>
      }
    >
      <WhyField value={why} onChange={setWhy} />
    </Dialog>
  );
}

/** «ليش؟»: optional, kept with the change and shown to the owner. */
export function WhyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t('console.stores.why')} htmlFor="store-why" hint={t('console.stores.why_hint')}>
      <Input id="store-why" value={value} maxLength={200} placeholder={t('console.stores.why_placeholder')} onChange={(e) => onChange(e.target.value)} className="h-11" />
    </Field>
  );
}

function ShopPhoto({ view, storeId, canEdit }: { view: MerchantSetupView; storeId: string; canEdit: boolean }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const write = useStoreWrite(storeId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation(trpc.ops.stores.shopPhoto.mutationOptions(write.handlers(t('console.stores.shop_photo_saved'))));
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const bad = photoProblem(file);
    if (bad) return setProblem(t(bad === 'type' ? 'console.pickup.photo_type' : 'console.pickup.photo_size'));
    setProblem(null);
    setBusy(true);
    try {
      const uploadId = await uploadPhoto(file, (i) => client.places.photoUpload.mutate(i), (url) => fileUrl(url, API_URL));
      await save.mutateAsync({ merchantOrgId: storeId, uploadId });
    } catch {
      setProblem(t('console.stores.upload_failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={t('console.stores.shop_photo')} hint={t('console.stores.shop_photo_hint')}>
      <div className="flex flex-wrap items-center gap-4">
        {view.shopPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed API URL
          <img src={fileUrl(view.shopPhotoUrl, API_URL)} alt={t('console.stores.shop_photo')} className="aspect-[4/3] w-48 rounded-md border border-line object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-48 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">{t('console.stores.shop_photo_none')}</div>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e)} />
        <Button size="lg" icon={busy ? <Spinner /> : <IconPlus size={18} />} disabled={!canEdit || busy} onClick={() => input.current?.click()}>
          {view.shopPhotoUrl ? t('console.stores.shop_photo_change') : t('console.stores.shop_photo_add')}
        </Button>
        {problem ? (
          <p role="alert" className="text-xs text-bad">
            {problem}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

// ───────────────────────── an open shop: its switches ─────────────────────────

const REASONS: readonly EarlyCloseReason[] = ['too_busy', 'no_staff', 'power_cut', 'sold_out', 'closing_early', 'other'];
const PAUSES = [15, 30, 60] as const;

type Pending = { kind: 'open' } | { kind: 'close' } | { kind: 'pause'; minutes: number } | { kind: 'busy'; extra: 10 | 20 } | { kind: 'calm' };

function Switches({ status, storeId, canEdit }: { status: StoreStatusView; storeId: string; canEdit: boolean }) {
  const net = useConsoleNetwork();
  const [pending, setPending] = useState<Pending | null>(null);
  const off = !canEdit || net.state === 'offline';
  const closedLine = status.closed
    ? status.closed.until
      ? t('console.stores.paused_until', { when: formatClockOf(status.closed.until) })
      : t(`console.stores.reason_${status.closed.reason}`)
    : null;
  return (
    <Card title={t('console.stores.switches')} hint={t('console.stores.switches_hint')}>
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone={status.open ? 'done' : 'warn'} dot>
          {status.open ? t('console.stores.now_open') : t('console.stores.now_closed')}
        </Chip>
        {closedLine ? <span className="text-dense text-muted">{closedLine}</span> : null}
        {status.busy.on ? (
          <Chip tone="warn" dot>
            {t('console.stores.state_busy', { min: status.busy.extraPrepMinutes })}
          </Chip>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-line p-4">
          <p className="text-sm font-medium text-text">{t('console.stores.sw_open')}</p>
          <div className="flex flex-wrap gap-2">
            {status.open ? (
              <>
                {PAUSES.map((m) => (
                  <Button key={m} size="lg" disabled={off} onClick={() => setPending({ kind: 'pause', minutes: m })}>
                    {t('console.stores.pause_for', { min: m })}
                  </Button>
                ))}
                <Button size="lg" variant="danger-soft" disabled={off} onClick={() => setPending({ kind: 'close' })}>
                  {t('console.stores.close_now')}
                </Button>
              </>
            ) : (
              <Button size="lg" variant="primary" disabled={off} onClick={() => setPending({ kind: 'open' })}>
                {t('console.stores.open_now')}
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-2 rounded-md border border-line p-4">
          <p className="text-sm font-medium text-text">{t('console.stores.sw_busy')}</p>
          <div className="flex flex-wrap gap-2">
            {status.busy.on ? (
              <Button size="lg" disabled={off} onClick={() => setPending({ kind: 'calm' })}>
                {t('console.stores.busy_off')}
              </Button>
            ) : (
              ([10, 20] as const).map((x) => (
                <Button key={x} size="lg" disabled={off} onClick={() => setPending({ kind: 'busy', extra: x })}>
                  {t('console.stores.busy_on', { min: x })}
                </Button>
              ))
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{t('console.stores.orders_untouched')}</p>
      {pending ? <SwitchDialog pending={pending} storeId={storeId} name={status.name} onClose={() => setPending(null)} /> : null}
    </Card>
  );
}

function formatClockOf(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Baghdad' }).format(d);
}

function SwitchDialog({ pending, storeId, name, onClose }: { pending: Pending; storeId: string; name: string; onClose: () => void }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [why, setWhy] = useState('');
  const [reason, setReason] = useState<EarlyCloseReason>('too_busy');
  const done = { ...write.handlers(t('console.stores.switch_saved', { name })), onSettled: onClose };
  const open = useMutation(trpc.ops.stores.setOpen.mutationOptions(done));
  const busy = useMutation(trpc.ops.stores.setBusy.mutationOptions(done));
  const w = why.trim() ? { why: why.trim() } : {};
  const S = { merchantOrgId: storeId };
  const title =
    pending.kind === 'open'
      ? t('console.stores.open_now')
      : pending.kind === 'close'
        ? t('console.stores.close_now')
        : pending.kind === 'pause'
          ? t('console.stores.pause_for', { min: pending.minutes })
          : pending.kind === 'busy'
            ? t('console.stores.busy_on', { min: pending.extra })
            : t('console.stores.busy_off');
  function run() {
    if (pending.kind === 'open') open.mutate({ ...S, open: true, ...w });
    else if (pending.kind === 'close') open.mutate({ ...S, open: false, reason, ...w });
    else if (pending.kind === 'pause') open.mutate({ ...S, open: false, reason, pauseMinutes: pending.minutes, ...w });
    else if (pending.kind === 'busy') busy.mutate({ ...S, on: true, extraMinutes: pending.extra, ...w });
    else busy.mutate({ ...S, on: false, ...w });
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={t('console.stores.switch_desc', { name })}
      footer={
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('console.stores.cancel')}
          </Button>
          <Button size="lg" variant="primary" loading={open.isPending || busy.isPending} onClick={run}>
            {t('console.stores.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pending.kind === 'close' || pending.kind === 'pause' ? (
          <Field label={t('console.stores.reason')} htmlFor="close-reason">
            <Select id="close-reason" value={reason} onChange={(e) => setReason(e.target.value as EarlyCloseReason)} className="h-11">
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`console.stores.reason_${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <WhyField value={why} onChange={setWhy} />
      </div>
    </Dialog>
  );
}
