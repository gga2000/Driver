'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMMISSION_TIER_ROLES, PICKUP_SPOT_RULES, pickupDraft, type ConsolePickupSpotView, type PickupDraft } from '@driver/contracts';
import type { StoreRow as StoreRowView } from '@driver/contracts/store-setup';
import { t } from '@driver/i18n';
import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fileUrl } from '@/lib/control-room';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText, useConsoleNetwork } from '@/lib/network';
import { parsePin, photoProblem, storeGaps, toFinish, uploadPhoto, type StoreGap } from '@/lib/pickup-spots';
import { normalizeAr } from '@/lib/store-setup';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC, useTRPCClient } from '@/lib/trpc';
import { CommissionCard } from './commission-card';
import { StoreWorkspace } from './stores/store-workspace';
import { Button, buttonCls, Card, Chip, cx, EmptyState, Field, IconClose, IconPlus, IconSearch, IconStore, Input, Meter, NeedLogin, PageHeader, QueryError, Segmented, Skeleton, Spinner, Textarea, useToast, type ChipTone } from './ui';

/**
 * Console › المطاعم: every restaurant and grocer in the city, shops still being set up first, and the
 * picked one to set up and keep for its owner (Ali, 2026-10-21: "our employees should be able to add
 * the restaurant and their items and images and set up everything for them") — the shop, its menu,
 * its hours, its pickup spot (Ali 2026-10-07) and the history of every change (`ops.stores.*`,
 * `ops.pickupSpots.*`; field ops and admins change, support reads). Saving follows the owner's rules
 * and is written to the Console audit log under the editor's name.
 */
export function StoresPage({ storeId }: { storeId: string | null }) {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader title={t('console.stores.title')} subtitle={t('console.stores.subtitle')} />
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,340px)_1fr]">
          <StoreList selected={storeId} />
          {storeId ? (
            // On a phone the picked store comes first; the list follows.
            <div className="order-first min-w-0 lg:order-none">
              <StoreWorkspace key={storeId} storeId={storeId} pickup={<PickupSpotEditor storeId={storeId} />} />
            </div>
          ) : (
            // The short summary comes first on a phone too, above the long list.
            <div className="order-first min-w-0 lg:order-none">
              <CityOverview />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── nothing picked: what the city still lacks ─────────────────────────

/**
 * With no store picked, the wide side shows how complete the city's stores are and what is missing
 * most, with one button to the store that needs the most work (instead of an empty "pick one" box).
 */
function CityOverview() {
  const trpc = useTRPC();
  const stores = useQuery(trpc.ops.pickupSpots.stores.queryOptions({ cityId: CITY_ID }, { retry: queryRetry }));
  const pickHint = <p className="mt-4 text-xs text-muted">{t('console.stores.pick_hint')}</p>;
  if (!stores.data) {
    if (stores.error) return <EmptyState icon={<IconStore size={20} />} title={t('console.stores.pick')} hint={t('console.stores.pick_hint')} />;
    return (
      <Card title={t('console.stores.overview')}>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-2 w-full rounded-pill" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }
  const rows = stores.data;
  const unfinished = toFinish(rows);
  const done = rows.length - unfinished.length;
  const gaps = rows.map(storeGaps);
  const count = (g: StoreGap) => gaps.filter((list) => list.includes(g)).length;
  const lines: Array<{ key: StoreGap; label: string; n: number }> = [
    { key: 'shop_photo', label: t('console.stores.gap_shop_photo'), n: count('shop_photo') },
    { key: 'spot', label: t('console.stores.spot_none'), n: count('spot') },
    { key: 'menu', label: t('console.stores.gap_menu'), n: count('menu') },
    { key: 'dish_photos', label: t('console.stores.ov_dishes'), n: count('dish_photos') },
  ];
  const next = unfinished[0];
  return (
    <Card title={t('console.stores.overview')} hint={t('console.stores.overview_done', { done, total: rows.length })}>
      <Meter value={done} max={Math.max(rows.length, 1)} tone={unfinished.length === 0 ? 'ok' : 'warn'} label={t('console.stores.overview_done', { done, total: rows.length })} />
      {unfinished.length === 0 ? (
        <p className="mt-4 text-sm text-ok">{t('console.stores.finish_none')}</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line/70">
            {lines.map((l) => (
              <li key={l.key} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                <span className={l.n > 0 ? 'text-text' : 'text-muted'}>{l.label}</span>
                <span className={cx('num font-semibold', l.n > 0 ? 'text-warn' : 'text-faint')}>{l.n}</span>
              </li>
            ))}
          </ul>
          {next ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
              <Link href={`/stores/${encodeURIComponent(next.merchantOrgId)}`} className={buttonCls('primary', 'lg')}>
                {t('console.stores.open_next', { name: next.name })}
              </Link>
            </div>
          ) : null}
        </>
      )}
      {pickHint}
    </Card>
  );
}

// ───────────────────────── the store list ─────────────────────────

const STATE_TONE: Record<StoreRowView['state'], ChipTone> = { setup: 'ready', closed: 'warn', live: 'done' };
const STATE_CHIP: Record<StoreRowView['state'], 'console.stores.chip_setup' | 'console.stores.chip_closed' | 'console.stores.chip_live'> = {
  setup: 'console.stores.chip_setup',
  closed: 'console.stores.chip_closed',
  live: 'console.stores.chip_live',
};

/** Shops in setup, closed shops, an empty menu or dishes without a photo: what still needs the team. */
function needsTeam(r: StoreRowView): boolean {
  return r.state !== 'live' || r.dishesNoPhoto > 0 || r.dishes === 0;
}

function StoreList({ selected }: { selected: string | null }) {
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'all' | 'need'>('all');
  const deferred = useDeferredValue(query);
  const stores = useQuery(trpc.ops.stores.list.queryOptions({ cityId: CITY_ID }, { retry: queryRetry }));
  const need = stores.data ? stores.data.filter(needsTeam) : [];
  const q = normalizeAr(deferred);
  const rows = stores.data ? (view === 'need' ? need : stores.data).filter((r) => !q || normalizeAr(r.name).includes(q)) : [];
  return (
    <Card title={t('console.stores.list')} hint={stores.data ? t('console.stores.list_hint', { n: need.length }) : undefined} flush>
      <div className="space-y-3 px-5 pb-3">
        <Segmented
          label={t('console.stores.list')}
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: t('console.stores.view_all'), ...(stores.data ? { count: stores.data.length } : {}) },
            { value: 'need', label: t('console.stores.view_need'), ...(stores.data ? { count: need.length } : {}) },
          ]}
        />
        <Input type="search" aria-label={t('console.stores.search')} placeholder={t('console.stores.search')} leading={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.target.value)} className="h-11" />
      </div>
      {stores.error ? (
        <div className="px-5 pb-5">
          <QueryError error={stores.error} onRetry={() => void stores.refetch()} />
        </div>
      ) : null}
      {!stores.data && stores.isPending ? (
        <div className="space-y-2 px-5 pb-5" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      ) : null}
      {stores.data && stores.data.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">{t('console.stores.empty')}</p> : null}
      {stores.data && stores.data.length > 0 && view === 'need' && need.length === 0 ? <p className="px-5 pb-5 text-sm text-ok">{t('console.stores.finish_none')}</p> : null}
      {stores.data && stores.data.length > 0 && rows.length === 0 && q ? <p className="px-5 pb-5 text-sm text-muted">{t('console.stores.no_match')}</p> : null}
      {rows.length > 0 ? (
        <ul className="relative max-h-[72vh] overflow-y-auto border-t border-line/70 pb-2" aria-label={t('console.stores.list')}>
          {rows.map((r) => (
            <li key={r.merchantOrgId}>
              <StoreRow row={r} active={r.merchantOrgId === selected} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function rowLine(row: StoreRowView): string {
  if (row.state === 'setup') return t('console.stores.row_setup', { done: row.steps.done, total: row.steps.total });
  if (row.dishes === 0) return t('console.stores.gap_menu');
  if (row.dishesNoPhoto > 0) return t('console.stores.row_no_photo', { n: row.dishesNoPhoto });
  return row.lastEdit ? t('console.stores.row_last', { name: row.lastEdit.actorName ?? t('console.someone'), when: formatDayClock(row.lastEdit.at) }) : t('console.stores.row_dishes', { n: row.dishes });
}

function StoreRow({ row, active }: { row: StoreRowView; active: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // The picked store stays in sight in a long list (opened from a link or after a reload): only the
  // list scrolls, never the page.
  useEffect(() => {
    const row = ref.current;
    const list = row?.closest('ul');
    if (!active || !row || !list) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop - list.clientHeight / 2;
  }, [active]);
  const warn = row.state === 'live' && needsTeam(row);
  return (
    <Link
      ref={ref}
      href={`/stores/${encodeURIComponent(row.merchantOrgId)}`}
      aria-current={active ? 'page' : undefined}
      className={cx('flex min-h-14 items-center gap-3 px-5 py-2 text-sm transition-colors duration-fast hover:bg-surface-2', active && 'bg-accent-tint')}
      data-testid="store-row"
    >
      <span aria-hidden className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface-3">
        {row.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed API URL
          <img src={fileUrl(row.photoUrl, API_URL)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-faint">
            <IconStore size={16} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate', active ? 'font-semibold text-text' : 'font-medium text-text')}>{row.name}</span>
        <span className={cx('block truncate text-xs', warn ? 'text-warn' : 'text-muted')}>{rowLine(row)}</span>
      </span>
      <Chip size="sm" tone={STATE_TONE[row.state]} dot>
        {t(STATE_CHIP[row.state])}
      </Chip>
    </Link>
  );
}

// ───────────────────────── the pickup-spot editor ─────────────────────────

function PickupSpotEditor({ storeId }: { storeId: string }) {
  const trpc = useTRPC();
  const spot = useQuery(trpc.ops.pickupSpots.get.queryOptions({ merchantOrgId: storeId }, { retry: queryRetry }));
  if (spot.error) return <QueryError error={spot.error} onRetry={() => void spot.refetch()} />;
  if (!spot.data) {
    return (
      <Card title={t('console.pickup.title')}>
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-4 w-2/3 rounded-md" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="aspect-[4/3] rounded-md" />
            <Skeleton className="aspect-[4/3] rounded-md" />
          </div>
          <Skeleton className="h-24 rounded-md" />
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <SpotForm view={spot.data} />
      <KitchenPlace view={spot.data} />
      <StoreCommission storeId={storeId} />
    </div>
  );
}

/** The store's commission tier: only finance and admins see it and change it (`COMMISSION_TIER_ROLES`). */
function StoreCommission({ storeId }: { storeId: string }) {
  const { roles } = useMyRoles();
  return hasAny(roles, COMMISSION_TIER_ROLES) ? <CommissionCard merchantOrgId={storeId} /> : null;
}

// ───────────────────────── «حرّك مكان المطعم» ─────────────────────────

/**
 * The kitchen's place on file (zone + pin) and «حرّك مكان المطعم»: field ops paste the right pin from a
 * map; the server reads the zone from it, refuses one outside town, and audits the move.
 */
function KitchenPlace({ view }: { view: ConsolePickupSpotView }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const net = useConsoleNetwork();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const pin = parsePin(text);
  const offline = net.state === 'offline';
  const move = useMutation(
    trpc.ops.pickupSpots.moveKitchen.mutationOptions({
      onSuccess: (saved) => {
        qc.setQueryData(trpc.ops.pickupSpots.get.queryKey({ merchantOrgId: saved.merchantOrgId }), saved);
        setText('');
        setTouched(false);
        toast({ title: t('console.kitchen.moved', { name: saved.storeName, zone: saved.kitchen?.zoneName ?? '' }), tone: 'ok' });
      },
      onError: (e) => toast({ title: t('console.kitchen.move_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const k = view.kitchen ?? null;
  const now = !k ? t('console.kitchen.none') : k.pin ? t('console.kitchen.now', { zone: k.zoneName, pin: `\u2066${k.pin.lat.toFixed(5)}, ${k.pin.lng.toFixed(5)}\u2069` }) : t('console.kitchen.no_pin', { zone: k.zoneName });
  return (
    <Card title={t('console.kitchen.title')} hint={view.storeName}>
      <p className="max-w-[68ch] text-sm text-muted">{t('console.kitchen.intro')}</p>
      <p className={cx('mt-2 text-dense', k?.pin ? 'text-text' : 'rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-text')} data-testid="kitchen-now">
        <bdi>{now}</bdi>
      </p>
      <Field className="mt-4" label={t('console.kitchen.pin_label')} htmlFor="kitchen-pin" {...(touched && text.trim() && !pin ? { error: t('console.kitchen.pin_bad') } : {})}>
        <Input id="kitchen-pin" dir="ltr" inputMode="decimal" placeholder={t('console.kitchen.pin_placeholder')} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} className="h-11" />
      </Field>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[48ch] text-xs text-muted">{offline ? t('console.net_offline') : t('console.kitchen.audited')}</p>
        <Button size="lg" variant="primary" loading={move.isPending} disabled={!pin || offline} onClick={() => pin && move.mutate({ merchantOrgId: view.merchantOrgId, pin })}>
          {t('console.kitchen.move')}
        </Button>
      </div>
    </Card>
  );
}

function SpotForm({ view }: { view: ConsolePickupSpotView }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const toast = useToast();
  const net = useConsoleNetwork();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PickupDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const base = pickupDraft.from(view);
  const current = draft ?? base;
  const dirty = !pickupDraft.same(current, base);
  const offline = net.state === 'offline';

  const save = useMutation(
    trpc.ops.pickupSpots.set.mutationOptions({
      onSuccess: (saved) => {
        qc.setQueryData(trpc.ops.pickupSpots.get.queryKey({ merchantOrgId: saved.merchantOrgId }), saved);
        void qc.invalidateQueries({ queryKey: trpc.ops.pickupSpots.stores.queryKey() });
        setDraft(null);
        const cleared = saved.note === null && saved.photos.length === 0;
        toast({ title: t(cleared ? 'console.pickup.cleared' : 'console.pickup.saved', { name: saved.storeName }), tone: 'ok' });
      },
      onError: (e) => toast({ title: t('console.pickup.save_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      setPhotoError(t(problem === 'type' ? 'console.pickup.photo_type' : 'console.pickup.photo_size'));
      return;
    }
    setPhotoError(null);
    setUploading(true);
    try {
      const id = await uploadPhoto(file, (input) => client.places.photoUpload.mutate(input), (url) => fileUrl(url, API_URL));
      setDraft((d) => pickupDraft.addPhoto(d ?? base, { id, url: URL.createObjectURL(file) }));
    } catch (err) {
      setPhotoError(t('console.pickup.upload_failed', { message: errorText(err instanceof Error ? err : null) }));
    } finally {
      setUploading(false);
    }
  }

  const last = view.consoleEdit
    ? t('console.pickup.by_console', { name: view.consoleEdit.byName ?? t('console.someone'), when: formatDayClock(view.consoleEdit.at) })
    : view.updatedAt
      ? t('console.pickup.by_owner', { when: formatDayClock(view.updatedAt) })
      : null;

  return (
    <Card title={t('console.pickup.title')} hint={view.storeName}>
      <p className="max-w-[68ch] text-sm text-muted">{t('console.pickup.intro')}</p>
      {last ? <p className="mt-2 text-dense text-text">{last}</p> : <p className="mt-3 rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-sm text-text">{t('console.pickup.never')}</p>}

      <section className="mt-5" aria-labelledby="pickup-photos">
        <h3 id="pickup-photos" className="text-dense font-semibold text-text">
          {t('console.pickup.photos')}
        </h3>
        <p className="text-xs text-muted">{t('console.pickup.photos_hint')}</p>
        {current.photos.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('console.pickup.photos_empty')}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {current.photos.map((p, i) => (
              <li key={p.id} className="relative overflow-hidden rounded-md border border-line bg-surface-3 leading-[0]">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs and local previews, not static assets */}
                <img src={fileUrl(p.url, API_URL)} alt={t('console.pickup.photo_alt', { n: i + 1 })} className="aspect-[4/3] w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setDraft(pickupDraft.removePhoto(current, p.id))}
                  aria-label={t('console.pickup.photo_remove', { n: i + 1 })}
                  title={t('console.pickup.photo_remove', { n: i + 1 })}
                  className="absolute end-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-text shadow-card transition-colors duration-fast hover:border-line-strong hover:bg-surface-2"
                >
                  <IconClose size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {pickupDraft.canAddPhoto(current) ? (
            <>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e)} />
              <Button size="lg" icon={uploading ? <Spinner /> : <IconPlus size={18} />} disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? t('console.pickup.uploading') : t('console.pickup.photo_add')}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted">{t('console.pickup.photos_full')}</p>
          )}
          {photoError ? (
            <p role="alert" className="text-xs text-bad">
              {photoError}
            </p>
          ) : null}
        </div>
      </section>

      <Field
        className="mt-5"
        label={t('console.pickup.note')}
        htmlFor="pickup-note"
        hint={t('console.pickup.note_left', { count: pickupDraft.noteLeft(current) })}
      >
        <Textarea
          id="pickup-note"
          value={current.note}
          maxLength={PICKUP_SPOT_RULES.noteMaxChars}
          placeholder={t('console.pickup.note_placeholder')}
          onChange={(e) => setDraft(pickupDraft.withNote(current, e.target.value))}
          rows={3}
        />
      </Field>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[48ch] text-xs text-muted">{offline ? t('console.net_offline') : t('console.pickup.audited')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <Button size="lg" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
              {t('console.pickup.undo')}
            </Button>
          ) : null}
          <Button size="lg" variant="primary" loading={save.isPending} disabled={!dirty || uploading || offline} onClick={() => save.mutate(pickupDraft.toInput(view.merchantOrgId, current))}>
            {t('console.pickup.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
