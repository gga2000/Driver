'use client';

import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatAreaKm2,
  ZONE_CHECK_RULES,
  ZONE_EDIT_ROLES,
  ZONE_TIER_ROLES,
  zoneProblemText,
  zoneServiceBounds,
  zoneShapeProblem,
  MovableZoneTier,
  type ZonePlacement,
  type ZonePlacementView,
  type ZoneShapeProblem,
  type ZoneTier,
  type ZoneTierFare,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import { TIERS_IN_ORDER } from '@driver/map';
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { isTypingTarget } from '@/lib/hotkeys';
import { tierLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { formatIqd } from '@/lib/format';
import { errorText } from '@/lib/network';
import { useTheme } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { MAP_LAYERS, type MapLayer } from '@/lib/map-editor';
import { closedEditor, editorReducer, isDirty, type EditorState } from '@/lib/zone-editor';
import { useMapEditor } from './map-editor';
import { Button, Chip, cx, Dialog, Field, Input, NeedLogin, PageHeader, QueryError, Skeleton, Tabs, useToast, type ChipTone } from './ui';

const ZonesMapCanvas = dynamic(() => import('./zones-map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted" role="status">
      {t('console.map_loading')}
    </div>
  ),
});

const STATE_TONE: Record<ZonePlacement, ChipTone> = { draft: 'warn', placed: 'done', confirmed: 'live' };
const stateLabel = (p: ZonePlacement): string => t(`console.zones_state_${p}`);

/** Drivers' "إي" so far against the count that confirms a placed outline (maps program SP3 §5.3). */
function ChecksChip({ zone }: { zone: ZonePlacementView }) {
  if (zone.placement !== 'placed' || !zone.checks) return null;
  const { yes, drivers } = zone.checks;
  return (
    <Chip size="sm" tone="neutral" title={t('console.zones_checks_hint', { need: ZONE_CHECK_RULES.yesToConfirm, minDrivers: ZONE_CHECK_RULES.distinctDrivers, drivers })}>
      {t('console.zones_checks', { yes, need: ZONE_CHECK_RULES.yesToConfirm })}
    </Chip>
  );
}

/** A driver said "لا" about this outline: the field team should go and look. */
function FlagChip({ zone }: { zone: ZonePlacementView }) {
  if (!zone.checks?.flaggedAt) return null;
  return (
    <Chip size="sm" tone="bad" dot title={t('console.zones_flagged_hint')}>
      {t('console.zones_flagged')}
    </Chip>
  );
}

/**
 * Console › النظام › المناطق (maps program SP3): Ali and field ops draw each zone's real outline over
 * the street map. Saving never moves a fee; switching pricing and dispatch to these outlines is a
 * separate step Ali approves.
 */
export function ZonesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const theme = useTheme();
  const { roles } = useMyRoles();
  const canEdit = hasAny(roles, ZONE_EDIT_ROLES);
  const canMoveGroup = hasAny(roles, ZONE_TIER_ROLES);
  const [nameForm, setNameForm] = useState<{ key?: string; name_ar: string; name_en: string; tier: ZoneTier; was?: ZoneTier; centre?: { lat: number; lng: number } } | null>(null);
  const [layer, setLayer] = useState<MapLayer>('zones');
  const [tilt, setTilt] = useState(false);
  const fares = useQuery(trpc.ops.zones.tierFares.queryOptions({ cityId: CITY_ID }, { enabled: signedIn && nameForm !== null, retry: queryRetry }));
  const list = useQuery(trpc.ops.zones.list.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry }));
  const [editor, dispatch] = useReducer(editorReducer, closedEditor);

  const zones = useMemo(() => list.data ?? [], [list.data]);
  const byKey = useMemo(() => new Map(zones.map((z) => [z.key, z])), [zones]);
  const open = editor.key ? (byKey.get(editor.key) ?? null) : null;
  const nameOf = useCallback((key: string) => byKey.get(key)?.name_ar ?? key, [byKey]);
  const problem = useMemo(() => {
    const bounds = zoneServiceBounds(CITY_ID);
    if (!editor.key || !bounds) return null;
    const others = zones.filter((z) => z.key !== editor.key && z.placement !== 'draft').map((z) => ({ key: z.key, ring: z.ring }));
    return zoneShapeProblem(editor.ring, editor.centre, bounds, others);
  }, [zones, editor.key, editor.ring, editor.centre]);
  const dirty = isDirty(editor);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.ops.zones.list.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.zones.map.queryKey() });
  };

  const save = useMutation(
    trpc.ops.zones.place.mutationOptions({
      onSuccess: (z) => {
        refresh();
        toast({ title: t('console.zones_saved_toast', { name: z.name_ar }), tone: 'ok' });
        dispatch({ type: 'open', key: z.key, ring: z.ring, centre: z.centre });
      },
    }),
  );
  const create = useMutation(trpc.ops.zones.create.mutationOptions({ onSuccess: (z) => { refresh(); dispatch({ type: 'open', key: z.key, ring: z.ring, centre: z.centre }); toast({ title: t('console.zones_created_toast', { name: z.name_ar }), tone: 'ok' }); } }));
  const rename = useMutation(trpc.ops.zones.rename.mutationOptions({ onSuccess: (z) => { refresh(); toast({ title: t('console.zones_renamed_toast', { name: z.name_ar }), tone: 'ok' }); } }));
  const setTier = useMutation(
    trpc.ops.zones.setTier.mutationOptions({
      onSuccess: (z) => { refresh(); toast({ title: t('console.zones_group_toast', { name: z.name_ar, group: tierLabel(z.tier) }), tone: 'ok' }); },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );
  const remove = useMutation(trpc.ops.zones.remove.mutationOptions({ onSuccess: () => { refresh(); dispatch({ type: 'close' }); toast({ title: t('console.zones_removed_toast'), tone: 'ok' }); } }));
  const clearFlag = useMutation(
    trpc.ops.zones.clearCheckFlag.mutationOptions({
      onSuccess: (z) => {
        refresh();
        toast({ title: t(z.placement === 'confirmed' ? 'console.zones_checked_confirmed_toast' : 'console.zones_checked_toast', { name: z.name_ar }), tone: 'ok' });
      },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );

  const addZone = useCallback((centre?: { lat: number; lng: number }) => setNameForm({ name_ar: '', name_en: '', tier: 'near', ...(centre ? { centre } : {}) }), []);
  const mapEd = useMapEditor({
    layer,
    setLayer,
    canEdit,
    onAddZone: (at) => {
      setLayer('zones');
      addZone(at);
    },
  });

  const submitNames = useCallback(() => {
    const name_ar = nameForm?.name_ar.trim();
    const name_en = nameForm?.name_en.trim();
    if (!nameForm || !name_ar || !name_en) return;
    if (nameForm.key) {
      const key = nameForm.key;
      const zone = byKey.get(key);
      const moveGroup = () => (nameForm.was !== nameForm.tier && MovableZoneTier.safeParse(nameForm.tier).success ? setTier.mutateAsync({ cityId: CITY_ID, key, tier: nameForm.tier as MovableZoneTier }) : Promise.resolve(null));
      const renamed = zone && (zone.name_ar !== name_ar || zone.name_en !== name_en) ? rename.mutateAsync({ cityId: CITY_ID, key, name_ar, name_en }) : Promise.resolve(null);
      void renamed.then(moveGroup).then(() => setNameForm(null)).catch(() => undefined);
      return;
    }
    const key = name_en.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
    if (key.length < 2) return;
    create.mutate({ cityId: CITY_ID, key, name_ar, name_en, tier: nameForm.tier, centre: nameForm.centre ?? { lat: 32.905, lng: 45.06 } }, { onSuccess: () => setNameForm(null) });
  }, [byKey, create, nameForm, rename, setTier]);

  const renameZone = useCallback((z: ZonePlacementView) => setNameForm({ key: z.key, name_ar: z.name_ar, name_en: z.name_en, tier: z.tier, was: z.tier }), []);

  const removeZone = useCallback((z: ZonePlacementView) => {
    if (!window.confirm(t('console.zones_confirm_remove', { name: z.name_ar }))) return;
    remove.mutate({ cityId: CITY_ID, key: z.key });
  }, [remove]);

  // A driver's "لا" is cleared only after a deliberate yes: it lifts the hold on confirmation.
  const markChecked = useCallback((z: ZonePlacementView) => {
    if (!window.confirm(t('console.zones_confirm_checked', { name: z.name_ar }))) return;
    clearFlag.mutate({ cityId: CITY_ID, key: z.key });
  }, [clearFlag]);

  const pick = useCallback(
    (key: string) => {
      if (key === editor.key) return;
      const z = byKey.get(key);
      if (!z) return;
      if (dirty && open && !window.confirm(t('console.zones_discard', { name: open.name_ar }))) return;
      save.reset();
      dispatch({ type: 'open', key: z.key, ring: z.ring, centre: z.centre });
    },
    [byKey, dirty, editor.key, open, save],
  );

  // Ctrl/⌘+Z undoes, Delete removes the selected corner, Esc deselects.
  useEffect(() => {
    if (!canEdit || layer !== 'zones') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || !editor.key) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selected !== null) {
        e.preventDefault();
        dispatch({ type: 'removeVertex', index: editor.selected });
      } else if (e.key === 'Escape') {
        dispatch({ type: 'select', index: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, layer, editor.key, editor.selected]);

  // Leaving the areas closes the open one (its handles would sit under the pins).
  const switchLayer = useCallback(
    (next: MapLayer) => {
      if (next === layer) return;
      if (layer === 'zones' && dirty && open && !window.confirm(t('console.zones_discard', { name: open.name_ar }))) return;
      if (layer === 'zones') dispatch({ type: 'close' });
      setLayer(next);
    },
    [layer, dirty, open],
  );

  if (!signedIn) {
    return (
      <div className="px-4 py-6 lg:px-8">
        <PageHeader title={t('console.zones_title')} subtitle={t('console.zones_subtitle')} />
        <NeedLogin />
      </div>
    );
  }

  return (
    <>
    <ZonesBoard
      zones={zones}
      loading={list.isPending}
      error={list.error ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      editor={editor}
      canEdit={canEdit}
      problem={problem}
      problemText={problem ? zoneProblemText(problem, nameOf) : null}
      dirty={dirty}
      saving={save.isPending}
      saveError={save.error ? errorText(save.error) : null}
      onPick={pick}
      onUndo={() => dispatch({ type: 'undo' })}
      onReset={() => dispatch({ type: 'reset' })}
      onRemoveCorner={() => editor.selected !== null && dispatch({ type: 'removeVertex', index: editor.selected })}
      onSave={() => editor.key && save.mutate({ cityId: CITY_ID, key: editor.key, ring: editor.ring, centre: editor.centre })}
      canManage={canEdit}
      mutating={create.isPending || rename.isPending || remove.isPending || setTier.isPending}
      onCreate={() => addZone()}
      layer={layer}
      onLayer={switchLayer}
      reviewCount={mapEd.reviewCount}
      tilt={tilt}
      onTilt={() => setTilt((x) => !x)}
      tools={mapEd.tools}
      aside={layer === 'zones' ? undefined : mapEd.aside}
      footer={layer === 'zones' ? undefined : mapEd.footer}
      overlay={mapEd.overlay}
      onRename={renameZone}
      onRemove={removeZone}
      onMarkChecked={markChecked}
      markingChecked={clearFlag.isPending}
      map={
        <ZonesMapCanvas
          theme={theme}
          zones={zones}
          editor={editor}
          editable={canEdit && layer === 'zones'}
          invalid={problem !== null}
          dispatch={dispatch}
          onPick={(key) => layer === 'zones' && pick(key)}
          zoneLabels={layer === 'zones'}
          tilt={tilt}
          pins={mapEd.pins}
          selectedPins={mapEd.selectedPins}
          link={mapEd.link}
          focus={mapEd.focus}
          placing={mapEd.placing}
          onPinPick={mapEd.onPinPick}
          onPinDrop={mapEd.onPinDrop}
          onRename={mapEd.onRename}
          onAddAt={canEdit ? mapEd.onAddAt : undefined}
          onMapClick={mapEd.onMapClick}
          onBoxSelect={mapEd.onBoxSelect}
        />
      }
    />
    <Dialog open={nameForm !== null} onClose={() => setNameForm(null)} title={t(nameForm?.key ? 'console.zones_edit' : 'console.zones_add')} footer={<><Button variant="ghost" onClick={() => setNameForm(null)}>{t('console.cancel')}</Button><Button variant="primary" onClick={submitNames} loading={create.isPending || rename.isPending || setTier.isPending} disabled={!nameForm?.name_ar.trim() || !nameForm?.name_en.trim()}>{t('console.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('console.zones_new_name_ar')}><Input autoFocus value={nameForm?.name_ar ?? ''} onChange={(e) => setNameForm((prev) => prev ? { ...prev, name_ar: e.target.value } : prev)} /></Field>
        <Field label={t('console.zones_new_name_en')}><Input value={nameForm?.name_en ?? ''} onChange={(e) => setNameForm((prev) => prev ? { ...prev, name_en: e.target.value } : prev)} /></Field>
        {nameForm ? <ZoneGroupPicker tier={nameForm.tier} was={nameForm.was} fares={fares.data} locked={Boolean(nameForm.key) && !canMoveGroup} onPick={(tier) => setNameForm((prev) => (prev ? { ...prev, tier } : prev))} /> : null}
      </div>
    </Dialog>
    </>
  );
}

/**
 * «المجموعة» (Ali, 2026-10-20): which band an area is in. The band prices every trip to and from it
 * when no exact pair is set, so each choice shows what a trip from the centre costs in it, and a
 * change says plainly that prices move from the next order on.
 */
export function ZoneGroupPicker({ tier, was, fares, locked = false, onPick }: { tier: ZoneTier; was?: ZoneTier; fares?: readonly ZoneTierFare[]; /** Only the admin moves an existing area between groups. */ locked?: boolean; onPick: (tier: MovableZoneTier) => void }) {
  if (was === 'edge') return <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{t('console.zones_group_edge')}</p>;
  const fareOf = (x: ZoneTier) => fares?.find((f) => f.tier === x);
  return (
    <div>
      <p className="text-sm font-medium">{t('console.zones_group')}</p>
      <p className="mb-2 text-xs text-muted">{t(locked ? 'console.zones_group_admin_only' : 'console.zones_group_hint')}</p>
      <div role="radiogroup" aria-label={t('console.zones_group')} className="grid grid-cols-2 gap-2">
        {MovableZoneTier.options.map((x) => {
          const f = fareOf(x);
          return (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={tier === x}
              disabled={locked}
              onClick={() => onPick(x)}
              className={cx('min-h-11 rounded-md border px-3 py-2 text-start transition-colors duration-fast disabled:cursor-not-allowed', tier === x ? 'border-accent bg-accent-tint' : 'border-line bg-surface enabled:hover:border-line-strong enabled:hover:bg-surface-2', locked && tier !== x && 'opacity-60')}
            >
              <span className="block text-sm font-semibold">{tierLabel(x)}</span>
              <span className="block text-xs text-muted">{f ? t('console.zones_group_fares', { delivery: formatIqd(f.deliveryIqd), taxi: formatIqd(f.taxiIqd), tuktuk: formatIqd(f.tuktukIqd) }) : '\u00a0'}</span>
            </button>
          );
        })}
      </div>
      {was && was !== tier ? <p role="status" className="mt-2 text-sm text-warn">{t('console.zones_group_changed', { from: tierLabel(was), to: tierLabel(tier) })}</p> : null}
    </div>
  );
}

export interface ZonesBoardProps {
  zones: readonly ZonePlacementView[];
  loading: boolean;
  error: ReactNode;
  editor: EditorState;
  canEdit: boolean;
  problem: ZoneShapeProblem | null;
  problemText: string | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  onPick: (key: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onRemoveCorner: () => void;
  onSave: () => void;
  canManage?: boolean;
  mutating?: boolean;
  onCreate?: () => void;
  onRename?: (zone: ZonePlacementView) => void;
  onRemove?: (zone: ZonePlacementView) => void;
  /** «انفحصت» on a flagged zone (Ali, 2026-10-06): the team looked and the outline is right. */
  onMarkChecked?: (zone: ZonePlacementView) => void;
  markingChecked?: boolean;
  map: ReactNode;
  /** Map editor (Ali, 2026-10-20): which layer is edited; absent = the areas only. */
  layer?: MapLayer;
  onLayer?: (layer: MapLayer) => void;
  reviewCount?: number;
  tilt?: boolean;
  onTilt?: () => void;
  tools?: ReactNode;
  /** A layer's own list and bottom bar, in place of the areas'. */
  aside?: ReactNode;
  footer?: ReactNode;
  /** Floating cards over the map (a place's card, the add ring). */
  overlay?: ReactNode;
}

/** The page without data fetching: header, zone list, map slot and the edit toolbar. */
export function ZonesBoard(p: ZonesBoardProps) {
  const placed = p.zones.filter((z) => z.placement !== 'draft').length;
  const open = p.editor.key ? p.zones.find((z) => z.key === p.editor.key) : undefined;
  const layer = p.layer ?? 'zones';
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5 lg:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-7">{t(p.onLayer ? 'console.mapedit_title' : 'console.zones_title')}</h1>
          <p className="max-w-[68ch] text-sm text-muted">{t(layer === 'zones' ? 'console.zones_subtitle' : 'console.mapedit_subtitle')}</p>
        </div>
        {layer === 'zones' && p.zones.length > 0 ? (
          <Chip tone={placed === p.zones.length ? 'done' : 'warn'} dot>
            {t('console.zones_progress', { n: placed, total: p.zones.length })}
          </Chip>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {p.onTilt ? (
            <Button size="sm" variant="secondary" aria-pressed={p.tilt ?? false} onClick={p.onTilt} title={t('console.mapedit_tilt_hint')}>
              {t('console.mapedit_tilt')}
            </Button>
          ) : null}
          {p.tools ?? null}
          {!p.canEdit ? <Chip>{t('console.zones_read_only')}</Chip> : p.canManage && layer === 'zones' ? <Button size="sm" variant="primary" onClick={() => p.onCreate?.()} loading={p.mutating}>{t('console.zones_add')}</Button> : null}
        </div>
      </header>
      {p.onLayer ? (
        <div className="border-b border-line px-3 lg:px-4">
          <Tabs
            label={t('console.mapedit_title')}
            value={layer}
            onChange={p.onLayer}
            options={MAP_LAYERS.map((value) => ({ value, label: t(`console.mapedit_layer_${value}`), ...(value === 'review' && p.reviewCount ? { count: p.reviewCount } : {}) }))}
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-e border-line bg-surface" aria-label={t(layer === 'zones' ? 'console.zones_title' : `console.mapedit_layer_${layer}`)}>
          {p.aside !== undefined ? p.aside : <>
          {p.error ?? null}
          {p.loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            TIERS_IN_ORDER.map((tier) => {
              const items = p.zones.filter((z) => z.tier === tier);
              if (items.length === 0) return null;
              return (
                <section key={tier} className="border-b border-line py-2">
                  <h2 className="px-3 pb-1 text-xs font-medium text-muted">{tierLabel(tier)}</h2>
                  <ul>
                    {items.map((z) => (
                      <li key={z.key}>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => p.onPick(z.key)} aria-current={z.key === p.editor.key ? 'true' : undefined} className={cx('flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-2', z.key === p.editor.key && 'bg-accent-tint')}>
                            <span className="min-w-0 truncate">{z.name_ar}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              <FlagChip zone={z} />
                              <Chip size="sm" tone={STATE_TONE[z.placement]}>{stateLabel(z.placement)}</Chip>
                            </span>
                          </button>
                          {p.canManage ? <span className="flex shrink-0 items-center gap-1 pe-2"><button type="button" className="rounded px-1 text-xs text-muted hover:bg-surface-2" aria-label={t('console.zones_rename')} onClick={() => p.onRename?.(z)}>✎</button><button type="button" className="rounded px-1 text-xs text-bad hover:bg-surface-2" aria-label={t('console.zones_remove')} onClick={() => p.onRemove?.(z)}>×</button></span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
          </>}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {p.map}
            {p.overlay ?? null}
          </div>
          <footer className="flex min-h-[3.75rem] flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-2.5">
            {p.footer !== undefined ? p.footer : open ? (
              <>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{open.name_ar}</span>
                    <Chip size="sm">{t('console.zones_area', { area: formatAreaKm2(open.areaM2) })}</Chip>
                    <Chip size="sm" tone={STATE_TONE[open.placement]}>
                      {stateLabel(open.placement)}
                    </Chip>
                    <ChecksChip zone={open} />
                    <FlagChip zone={open} />
                    {open.placedBy ? <span className="text-xs text-muted">{t('console.zones_placed_by', { name: open.placedBy })}</span> : null}
                  </div>
                  <p role="status" className={cx('mt-0.5 text-sm', p.problemText || p.saveError ? 'text-bad' : p.dirty ? 'text-warn' : 'text-muted')}>
                    {p.saveError ?? p.problemText ?? (p.dirty ? t('console.zones_unsaved') : p.canEdit ? t('console.zones_help') : '')}
                  </p>
                </div>
                {p.canEdit ? (
                  <div className="ms-auto flex flex-wrap items-center gap-2">
                    {open.checks?.flaggedAt && p.onMarkChecked ? (
                      <Button size="lg" variant="secondary" onClick={() => p.onMarkChecked?.(open)} loading={p.markingChecked}>
                        {t('console.zones_mark_checked')}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={p.onUndo} disabled={p.editor.undo.length === 0}>
                      {t('console.zones_undo')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={p.onReset} disabled={!p.dirty}>
                      {t('console.zones_reset')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={p.onRemoveCorner} disabled={p.editor.selected === null || p.editor.ring.length <= 3}>
                      {t('console.zones_remove_point')}
                    </Button>
                    <Button size="sm" variant="primary" onClick={p.onSave} disabled={!p.dirty || p.problem !== null} loading={p.saving}>
                      {t('console.zones_save')}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted">{t('console.zones_pick')}</p>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
