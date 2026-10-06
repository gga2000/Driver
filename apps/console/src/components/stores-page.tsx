'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PICKUP_SPOT_RULES, pickupDraft, type ConsolePickupSpotView, type PickupDraft, type PickupStoreRow } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fileUrl } from '@/lib/control-room';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText, useConsoleNetwork } from '@/lib/network';
import { filterStores, missingCount, photoProblem, uploadPhoto } from '@/lib/pickup-spots';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC, useTRPCClient } from '@/lib/trpc';
import { Button, Card, Chip, cx, EmptyState, Field, IconClose, IconPlus, IconSearch, IconStore, Input, NeedLogin, PageHeader, QueryError, Skeleton, Spinner, Textarea, useToast } from './ui';

/**
 * Console › المطاعم (Ali 2026-10-07): every restaurant and grocer in the city with how its pickup
 * spot stands, and the picked store's spot to view and edit — the photos and note couriers see on
 * their job (`ops.pickupSpots.*`, field ops and admins). Saving follows the owner's rules and is
 * written to the Console audit log under the editor's name.
 */
export function StoresPage({ storeId }: { storeId: string | null }) {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('console.stores.title')} subtitle={t('console.stores.subtitle')} />
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <StoreList selected={storeId} />
          {storeId ? (
            // On a phone the picked store's spot comes first; the list follows.
            <div className="order-first min-w-0 lg:order-none">
              <PickupSpotEditor key={storeId} storeId={storeId} />
            </div>
          ) : (
            <EmptyState icon={<IconStore size={20} />} title={t('console.stores.pick')} hint={t('console.stores.pick_hint')} />
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── the store list ─────────────────────────

function StoreList({ selected }: { selected: string | null }) {
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const stores = useQuery(trpc.ops.pickupSpots.stores.queryOptions({ cityId: CITY_ID }, { retry: queryRetry }));
  const rows = stores.data ? filterStores(stores.data, deferred) : [];
  return (
    <Card title={t('console.stores.list')} hint={stores.data ? t('console.stores.hint', { n: missingCount(stores.data) }) : undefined} flush>
      <div className="px-5 pb-3">
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
            <Skeleton key={i} className="h-11 rounded-md" />
          ))}
        </div>
      ) : null}
      {stores.data && stores.data.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">{t('console.stores.empty')}</p> : null}
      {stores.data && stores.data.length > 0 && rows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">{t('console.stores.no_match')}</p> : null}
      {rows.length > 0 ? (
        <ul className="relative max-h-[70vh] overflow-y-auto border-t border-line/70 pb-2" aria-label={t('console.stores.list')}>
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

function StoreRow({ row, active }: { row: PickupStoreRow; active: boolean }) {
  const set = row.note !== null || row.photos > 0;
  const ref = useRef<HTMLAnchorElement>(null);
  // The picked store stays in sight in a long list (opened from a link or after a reload): only the
  // list scrolls, never the page.
  useEffect(() => {
    const row = ref.current;
    const list = row?.closest('ul');
    if (!active || !row || !list) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop - list.clientHeight / 2;
  }, [active]);
  return (
    <Link
      ref={ref}
      href={`/stores/${encodeURIComponent(row.merchantOrgId)}`}
      aria-current={active ? 'page' : undefined}
      className={cx('flex min-h-11 items-center gap-3 px-5 py-2 text-sm transition-colors duration-fast hover:bg-surface-2', active && 'bg-accent-tint')}
    >
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate', active ? 'font-semibold text-text' : 'font-medium text-text')}>{row.name}</span>
        <span className="block truncate text-xs text-muted">{row.note ?? (set ? '' : t('console.stores.spot_none'))}</span>
      </span>
      <Chip size="sm" tone={set ? 'ready' : 'warn'} dot>
        {t('console.stores.photos', { n: row.photos })}
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
  return <SpotForm view={spot.data} />;
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
