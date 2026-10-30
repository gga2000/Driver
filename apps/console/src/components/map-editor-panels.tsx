'use client';

import { LANDMARK_CATEGORIES, MAP_EDITOR_RULES, type LandmarkCategory, type LatLng, type MapDuplicate, type MapEditView, type MapLandmark, type MapReportCard, type MapRestaurant } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { glyphSvgMarkup, landmarkGlyph } from '@driver/map';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatClock, formatDate } from '@/lib/format';
import { matchesQuery, parseAliases } from '@/lib/map-editor';
import { Button, Chip, cx, EmptyState, Field, Input, Sheet, Skeleton, Switch, Tabs } from './ui';

export const catLabel = (c: LandmarkCategory) => t(`console.mapedit_cat_${c}` as MessageKey);

/** A landmark's icon, the same drawing every app map uses. */
export function CategoryGlyph({ category, className }: { category: LandmarkCategory; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cx('h-4 w-4 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.9]', className)} dangerouslySetInnerHTML={{ __html: glyphSvgMarkup(landmarkGlyph(category)) }} />
  );
}

const when = (d: Date) => `${formatDate(d)} · ${formatClock(d)}`;

// ───────────────────────── lists ─────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-b border-line p-2">
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('console.mapedit_search')} aria-label={t('console.mapedit_search')} />
    </div>
  );
}

export function RestaurantList({ items, loading, selected, onPick }: { items: readonly MapRestaurant[]; loading: boolean; selected: ReadonlySet<string>; onPick: (orgId: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((r) => matchesQuery(q, r.name, r.zoneName)), [items, q]);
  return (
    <>
      <SearchBox value={q} onChange={setQ} />
      {loading ? <ListSkeleton /> : items.length === 0 ? <EmptyState bare title={t('console.mapedit_empty_restaurants')} /> : shown.length === 0 ? <EmptyState bare title={t('console.mapedit_no_match')} /> : (
        <ul>
          {shown.map((r) => (
            <li key={r.orgId}>
              <button type="button" onClick={() => onPick(r.orgId)} aria-current={selected.has(`restaurant:${r.orgId}`) ? 'true' : undefined} className={cx('flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-2', selected.has(`restaurant:${r.orgId}`) && 'bg-accent-tint')}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  {r.zoneName ? <span className="block truncate text-xs text-muted">{r.zoneName}</span> : null}
                </span>
                {r.pin ? null : <Chip size="sm" tone="warn">{t('console.mapedit_no_pin')}</Chip>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function LandmarkList({ items, loading, selected, onPick }: { items: readonly MapLandmark[]; loading: boolean; selected: ReadonlySet<string>; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((l) => matchesQuery(q, l.name_ar, ...l.aliases_ar)), [items, q]);
  return (
    <>
      <SearchBox value={q} onChange={setQ} />
      {loading ? <ListSkeleton /> : items.length === 0 ? <EmptyState bare title={t('console.mapedit_empty_landmarks')} /> : shown.length === 0 ? <EmptyState bare title={t('console.mapedit_no_match')} /> : (
        <ul>
          {shown.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => onPick(l.id)} aria-current={selected.has(`landmark:${l.id}`) ? 'true' : undefined} className={cx('flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-2', selected.has(`landmark:${l.id}`) && 'bg-accent-tint', l.hidden && 'text-muted')}>
                <CategoryGlyph category={l.category} className="text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.name_ar}</span>
                  {l.aliases_ar.length > 0 ? <span className="block truncate text-xs text-muted">{l.aliases_ar.join('، ')}</span> : null}
                </span>
                {l.hidden ? <Chip size="sm">{t('console.mapedit_hidden')}</Chip> : l.seeded ? <Chip size="sm" tone="neutral">{t('console.mapedit_seeded')}</Chip> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ───────────────────────── inspector ─────────────────────────

export interface LandmarkDraft {
  /** Absent: a new landmark at `pin`. */
  id?: string;
  name_ar: string;
  aliases: string;
  category: LandmarkCategory;
  pin: LatLng;
  hidden: boolean;
}

export const draftOf = (l: MapLandmark): LandmarkDraft => ({ id: l.id, name_ar: l.name_ar, aliases: l.aliases_ar.join('، '), category: l.category, pin: l.pin, hidden: l.hidden });

/** The kinds a landmark can be on the map (a garage only comes from the city setup). */
const PICKABLE = LANDMARK_CATEGORIES.filter((c) => c !== 'garage');

export function CategoryPicker({ value, onPick }: { value: LandmarkCategory; onPick: (c: LandmarkCategory) => void }) {
  return (
    <div role="radiogroup" aria-label={t('console.mapedit_kind')} className="grid grid-cols-4 gap-1.5">
      {PICKABLE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onPick(c)}
          className={cx('flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1 text-[11px] font-medium', value === c ? 'border-accent bg-accent-tint text-text' : 'border-line bg-surface text-muted hover:border-line-strong')}
        >
          <CategoryGlyph category={c} className="h-5 w-5" />
          {catLabel(c)}
        </button>
      ))}
    </div>
  );
}

/** The floating card on the map for one landmark: name, other names, kind, on the map or not. */
export function LandmarkInspector({
  draft,
  landmark,
  canEdit,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  draft: LandmarkDraft;
  landmark: MapLandmark | null;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  onChange: (d: LandmarkDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const seeded = landmark?.seeded ?? false;
  const editable = canEdit && !seeded;
  const isNew = !draft.id;
  const dirty = !landmark || draft.name_ar.trim() !== landmark.name_ar || parseAliases(draft.aliases).join('|') !== landmark.aliases_ar.join('|') || draft.category !== landmark.category || draft.hidden !== landmark.hidden;
  return (
    <section aria-label={isNew ? t('console.mapedit_new_landmark') : draft.name_ar} className="absolute end-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border border-line bg-raised p-4 shadow-pop">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CategoryGlyph category={draft.category} className="h-5 w-5 text-muted" />
          <h2 className="truncate text-base font-bold">{isNew ? t('console.mapedit_new_landmark') : landmark?.name_ar}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={t('console.close')} className="-m-1 rounded p-2 text-muted hover:bg-surface-2">×</button>
      </header>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs, not static assets */}
      {landmark?.photoUrl ? <img src={landmark.photoUrl} alt="" className="mb-3 aspect-[16/9] w-full rounded-md object-cover" /> : null}
      {seeded ? <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{t('console.mapedit_seeded_note')}</p> : null}
      <div className="space-y-3">
        <Field label={t('console.mapedit_name')}>
          <Input autoFocus={isNew} value={draft.name_ar} maxLength={MAP_EDITOR_RULES.nameMax} disabled={!editable} onChange={(e) => onChange({ ...draft, name_ar: e.target.value })} />
        </Field>
        <Field label={t('console.mapedit_aliases')} hint={t('console.mapedit_aliases_hint')}>
          <Input value={draft.aliases} disabled={!editable} onChange={(e) => onChange({ ...draft, aliases: e.target.value })} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('console.mapedit_kind')}</p>
          {editable ? <CategoryPicker value={draft.category} onPick={(category) => onChange({ ...draft, category })} /> : <Chip>{catLabel(draft.category)}</Chip>}
        </div>
        {editable && !isNew ? (
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('console.mapedit_on_map')}</span>
            <Switch on={!draft.hidden} onToggle={() => onChange({ ...draft, hidden: !draft.hidden })} label={t('console.mapedit_on_map')} />
          </div>
        ) : null}
        {editable ? <p className="text-xs text-muted">{t('console.mapedit_drag_hint')}</p> : null}
        {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
      </div>
      {editable ? (
        <footer className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">{t('console.mapedit_apps_note')}</p>
          <Button variant="primary" onClick={onSave} loading={saving} disabled={!draft.name_ar.trim() || (!isNew && !dirty)}>
            {t('console.mapedit_save')}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export function RestaurantInspector({ restaurant, canEdit, placing, onPlace, onClose }: { restaurant: MapRestaurant; canEdit: boolean; placing: boolean; onPlace: () => void; onClose: () => void }) {
  return (
    <section aria-label={restaurant.name} className="absolute end-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border border-line bg-raised p-4 shadow-pop">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="truncate text-base font-bold">{restaurant.name}</h2>
        <button type="button" onClick={onClose} aria-label={t('console.close')} className="-m-1 rounded p-2 text-muted hover:bg-surface-2">×</button>
      </header>
      <dl className="space-y-1 text-sm">
        {restaurant.zoneName ? <div className="flex gap-2"><dt className="text-muted">{t('console.mapedit_zone')}</dt><dd>{restaurant.zoneName}</dd></div> : null}
        {restaurant.pickupNote ? <div className="flex gap-2"><dt className="shrink-0 text-muted">{t('console.mapedit_pickup')}</dt><dd className="min-w-0">{restaurant.pickupNote}</dd></div> : null}
      </dl>
      <p className="mt-3 text-xs text-muted">{restaurant.pin ? (canEdit ? t('console.mapedit_drag_hint_restaurant') : '') : placing ? t('console.mapedit_placing_hint') : t('console.mapedit_no_pin_hint')}</p>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/stores/${restaurant.orgId}`} className="text-sm font-medium text-accent-text underline-offset-2 hover:underline">
          {t('console.mapedit_open_store')}
        </Link>
        {canEdit && !restaurant.pin ? (
          <Button size="sm" variant={placing ? 'secondary' : 'primary'} onClick={onPlace} aria-pressed={placing}>
            {t('console.mapedit_place')}
          </Button>
        ) : null}
      </footer>
    </section>
  );
}

// ───────────────────────── add menu ─────────────────────────

/** Press and hold on the map: a ring of what can go there, the new place's pin in the middle. */
export function AddMenu({ at, onPick, onZone, onClose }: { at: { x: number; y: number }; onPick: (c: LandmarkCategory) => void; onZone?: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const items: Array<{ key: string; label: string; glyph?: LandmarkCategory; run: () => void }> = [
    ...PICKABLE.map((c) => ({ key: c, label: catLabel(c), glyph: c, run: () => onPick(c) })),
    ...(onZone ? [{ key: 'zone', label: t('console.mapedit_add_zone'), run: onZone }] : []),
  ];
  const R = 78;
  return (
    <div className="absolute inset-0 z-20" onMouseDown={onClose} role="presentation">
      <div role="menu" aria-label={t('console.mapedit_add_menu')} className="map-edit-ring absolute h-0 w-0" style={{ left: at.x, top: at.y }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="absolute -left-[104px] -top-[104px] h-[208px] w-[208px] rounded-full border border-line bg-raised/95 shadow-pop" />
        <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-text bg-accent" aria-hidden="true" />
        {items.map((it, i) => {
          const a = (i / items.length) * 2 * Math.PI - Math.PI / 2;
          return (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              autoFocus={i === 0}
              onClick={it.run}
              className="absolute flex h-12 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-semibold text-text hover:bg-accent-tint focus-visible:bg-accent-tint"
              style={{ left: Math.cos(a) * R, top: Math.sin(a) * R }}
            >
              {it.glyph ? <CategoryGlyph category={it.glyph} className="h-5 w-5" /> : <span aria-hidden="true" className="h-5 w-5 rounded-sm border-2 border-dashed border-current" />}
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── history ─────────────────────────

export function HistorySheet({ open, onClose, edits, loading, undoing, onUndo }: { open: boolean; onClose: () => void; edits: readonly MapEditView[]; loading: boolean; undoing: string | null; onUndo: (id: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('console.mapedit_history_title')}>
      {loading ? <ListSkeleton /> : edits.length === 0 ? <EmptyState bare title={t('console.mapedit_history_empty')} /> : (
        <ol className="divide-y divide-line">
          {edits.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={cx('text-sm font-medium', e.undoneAt && 'text-muted line-through')}>{e.summaryAr}</p>
                <p className="text-xs text-muted">
                  {e.byName ? `${e.byName} · ` : ''}
                  {when(e.at)}
                  {e.undoneAt ? ` · ${t('console.mapedit_undone')}` : ''}
                </p>
              </div>
              {e.canUndo ? (
                <Button size="sm" variant="secondary" onClick={() => onUndo(e.id)} loading={undoing === e.id}>
                  {t('console.mapedit_undo')}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

// ───────────────────────── review inbox ─────────────────────────

export type ReviewTab = 'road' | 'shops' | 'dupes';
export type ReviewPick = { kind: 'card'; card: MapReportCard } | { kind: 'dupe'; dupe: MapDuplicate };
export const reviewKey = (p: ReviewPick) => (p.kind === 'card' ? `c:${p.card.reportIds[0]}` : `d:${p.dupe.drop.id}`);
export const dupeKey = (d: MapDuplicate) => `${d.keep.id}|${d.drop.id}`;

export function cardTitle(c: MapReportCard): string {
  const name = c.target?.name ?? c.proposedName ?? '';
  switch (c.kind) {
    case 'moved':
      return t('console.mapedit_card_moved', { name, m: c.distanceM ?? 0 });
    case 'new_place':
      return t('console.mapedit_card_new', { name });
    case 'wrong_name':
      return t('console.mapedit_card_wrong_name', { name, right: c.proposedName ?? '' });
    case 'closed':
      return t('console.mapedit_card_closed', { name });
  }
}

export function ReviewList({
  tab,
  onTab,
  cards,
  dupes,
  counts,
  loading,
  picked,
  onPick,
}: {
  tab: ReviewTab;
  onTab: (t: ReviewTab) => void;
  cards: readonly MapReportCard[];
  dupes: readonly MapDuplicate[];
  counts: { road: number; shops: number; dupes: number };
  loading: boolean;
  picked: string | null;
  onPick: (p: ReviewPick) => void;
}) {
  const shown = cards.filter((c) => (tab === 'shops' ? c.source === 'merchant' : c.source !== 'merchant'));
  return (
    <>
      <div className="border-b border-line px-2 pt-1">
        <Tabs
          label={t('console.mapedit_layer_review')}
          value={tab}
          onChange={onTab}
          options={[
            { value: 'road', label: t('console.mapedit_review_road'), count: counts.road },
            { value: 'shops', label: t('console.mapedit_review_shops'), count: counts.shops },
            { value: 'dupes', label: t('console.mapedit_review_dupes'), count: counts.dupes },
          ]}
        />
      </div>
      {loading ? <ListSkeleton /> : tab === 'dupes' ? (
        dupes.length === 0 ? <EmptyState bare title={t('console.mapedit_dupes_empty')} /> : (
          <ul className="space-y-2 p-2">
            {dupes.map((d) => {
              const key = reviewKey({ kind: 'dupe', dupe: d });
              return (
                <li key={key}>
                  <button type="button" onClick={() => onPick({ kind: 'dupe', dupe: d })} aria-current={picked === key ? 'true' : undefined} className={cx('w-full rounded-md border px-3 py-2.5 text-start', picked === key ? 'border-accent bg-accent-tint' : 'border-line bg-surface hover:border-line-strong')}>
                    <span className="block text-sm font-semibold">{t('console.mapedit_dupe_title', { a: d.drop.name_ar, b: d.keep.name_ar })}</span>
                    <span className="block text-xs text-muted">{t('console.mapedit_dupe_meta', { m: d.distanceM })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : shown.length === 0 ? (
        <EmptyState bare title={t('console.mapedit_review_empty')} />
      ) : (
        <ul className="space-y-2 p-2">
          {shown.map((c) => {
            const key = reviewKey({ kind: 'card', card: c });
            return (
              <li key={key}>
                <button type="button" onClick={() => onPick({ kind: 'card', card: c })} aria-current={picked === key ? 'true' : undefined} className={cx('w-full rounded-md border px-3 py-2.5 text-start', picked === key ? 'border-accent bg-accent-tint' : 'border-line bg-surface hover:border-line-strong')}>
                  <span className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{c.reporters > 1 ? t('console.mapedit_card_said', { n: c.reporters }) : t('console.mapedit_card_said_one')}</span>
                    <span className="num">{formatClock(c.lastAt)}</span>
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold">{cardTitle(c)}</span>
                  {c.notes[0] ? <span className="block truncate text-xs text-muted">«{c.notes[0]}»</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The bar under the map for the picked fix: what it says, and accept / adjust / reject. */
export function ReviewBar({
  pick,
  canEdit,
  adjusting,
  busy,
  error,
  onAccept,
  onReject,
  onAdjust,
  onMerge,
  onNotSame,
}: {
  pick: ReviewPick | null;
  canEdit: boolean;
  adjusting: boolean;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
  onAdjust: () => void;
  onMerge: () => void;
  onNotSame: () => void;
}) {
  useEffect(() => {
    if (!pick || !canEdit || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || el?.closest('input,textarea,select,[contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        if (pick.kind === 'card') onAccept();
        else onMerge();
      } else if (k === 'x') {
        e.preventDefault();
        if (pick.kind === 'card') onReject();
        else onNotSame();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick, canEdit, busy, onAccept, onReject, onMerge, onNotSame]);

  if (!pick) return <p className="text-sm text-muted">{t('console.mapedit_review_pick')}</p>;
  if (pick.kind === 'dupe') {
    const d = pick.dupe;
    return (
      <>
        <div className="min-w-0">
          <p className="font-semibold">{t('console.mapedit_dupe_title', { a: d.drop.name_ar, b: d.keep.name_ar })}</p>
          <p className="text-sm text-muted">{t('console.mapedit_dupe_explain', { drop: d.drop.name_ar, keep: d.keep.name_ar })}</p>
          {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
        </div>
        {canEdit ? (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onNotSame} kbd="X">{t('console.mapedit_not_same')}</Button>
            <Button variant="primary" onClick={onMerge} loading={busy} kbd="A">{t('console.mapedit_merge')}</Button>
          </div>
        ) : null}
      </>
    );
  }
  const c = pick.card;
  const filesOnly = c.target?.kind === 'restaurant' && (c.kind === 'wrong_name' || c.kind === 'closed');
  return (
    <>
      <div className="min-w-0">
        <p className="font-semibold">{cardTitle(c)}</p>
        <p className="text-sm text-muted">
          {c.reporters > 1 ? t('console.mapedit_card_said', { n: c.reporters }) : t('console.mapedit_card_said_one')} · {when(c.firstAt)}
          {c.notes.length > 0 ? ` · ${c.notes.map((n) => `«${n}»`).join(' ')}` : ''}
        </p>
        {filesOnly ? <p className="text-sm text-muted">{t('console.mapedit_store_card_note')}</p> : adjusting ? <p className="text-sm text-warn">{t('console.mapedit_adjust_hint')}</p> : null}
        {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
      </div>
      {canEdit ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {c.proposedPin && !filesOnly ? (
            <Button variant="secondary" onClick={onAdjust} aria-pressed={adjusting}>
              {t('console.mapedit_adjust')}
            </Button>
          ) : null}
          <Button variant="danger-soft" onClick={onReject} disabled={busy} kbd="X">{t('console.mapedit_reject')}</Button>
          <Button variant="primary" onClick={onAccept} loading={busy} kbd="A">{t('console.mapedit_accept')}</Button>
        </div>
      ) : null}
    </>
  );
}

