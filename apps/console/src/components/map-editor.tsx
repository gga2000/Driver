'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LandmarkCategory, LatLng, MapLayers } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CITY_ID, queryRetry } from '@/lib/live';
import { emptyLayers, groupMove, landmarkPins, parseAliases, pinKey, restaurantPins, type EditorPin, type MapLayer } from '@/lib/map-editor';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import {
  AddMenu,
  draftOf,
  dupeKey,
  HistorySheet,
  LandmarkInspector,
  LandmarkList,
  RestaurantInspector,
  RestaurantList,
  ReviewBar,
  ReviewList,
  reviewKey,
  type LandmarkDraft,
  type ReviewPick,
  type ReviewTab,
} from './map-editor-panels';
import { Button, Chip, useToast } from './ui';

/** Duplicates the team said are two places (this browser only; they come back after clearing it). */
const NOT_SAME_KEY = 'driver.console.mapedit.not_same';
function readNotSame(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NOT_SAME_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeNotSame(keys: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(NOT_SAME_KEY, JSON.stringify([...keys]));
  } catch {
    // A blocked store only means the pair shows again next time.
  }
}

const DRAFT_KEY = 'landmark:__new';

export interface MapEditorView {
  pins?: readonly EditorPin[];
  selectedPins: ReadonlySet<string>;
  link: { from: LatLng; to: LatLng } | null;
  focus: { key: string; points: readonly LatLng[] } | null;
  placing: boolean;
  aside: ReactNode;
  footer: ReactNode;
  overlay: ReactNode;
  tools: ReactNode;
  reviewCount: number;
  onPinPick: (key: string, additive: boolean) => void;
  onPinDrop: (key: string, to: LatLng) => void;
  onRename: (key: string, name: string) => void;
  onAddAt: (at: LatLng, screen: { x: number; y: number }) => void;
  onMapClick: (at: LatLng) => void;
  onBoxSelect: (keys: string[]) => void;
}

/**
 * Console › محرر الخريطة (Ali, 2026-10-20), everything but the areas: restaurants and landmarks on the
 * same map (pick, drag, Shift to pick several and move them together, double-click a name to rename,
 * press and hold to add), the history with undo, and the inbox of fixes from the road and the shops.
 */
export function useMapEditor({ layer, setLayer, canEdit, onAddZone }: { layer: MapLayer; setLayer: (l: MapLayer) => void; canEdit: boolean; onAddZone: (at: LatLng) => void }): MapEditorView {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const layersQ = useQuery(trpc.ops.mapEditor.layers.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry }));
  const inboxQ = useQuery(trpc.ops.mapEditor.inbox.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry, refetchInterval: 60_000 }));
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyQ = useQuery(trpc.ops.mapEditor.history.queryOptions({ cityId: CITY_ID, limit: 50 }, { enabled: signedIn && historyOpen, retry: queryRetry }));
  const data: MapLayers = layersQ.data ?? emptyLayers;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<LandmarkDraft | null>(null);
  const [addAt, setAddAt] = useState<{ at: LatLng; screen: { x: number; y: number } } | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: string; points: readonly LatLng[] } | null>(null);
  const [reviewTab, setReviewTab] = useState<ReviewTab>('road');
  const [pick, setPick] = useState<ReviewPick | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustPin, setAdjustPin] = useState<LatLng | null>(null);
  const [notSame, setNotSame] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setNotSame(readNotSame()), []);

  // A new layer starts with nothing picked.
  useEffect(() => {
    setSelected(new Set());
    setPlacing(null);
    setAddAt(null);
    if (layer !== 'landmarks') setDraft(null);
  }, [layer]);

  // Opening the restaurants or landmarks layer frames all of its places once.
  const framed = useRef<MapLayer | null>(null);
  useEffect(() => {
    if (layer !== 'restaurants' && layer !== 'landmarks') {
      framed.current = null;
      return;
    }
    if (!layersQ.isSuccess || framed.current === layer) return;
    const points = layer === 'restaurants' ? data.restaurants.flatMap((r) => (r.pin ? [r.pin] : [])) : data.landmarks.map((l) => l.pin);
    framed.current = layer;
    if (points.length > 0) setFocus({ key: `layer:${layer}:${Date.now()}`, points });
  }, [layer, layersQ.isSuccess, data]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: trpc.ops.mapEditor.layers.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.mapEditor.inbox.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.mapEditor.history.queryKey() });
  }, [qc, trpc]);
  const fail = useCallback((e: Parameters<typeof errorText>[0]) => toast({ title: errorText(e), tone: 'bad' }), [toast]);

  const add = useMutation(trpc.ops.mapEditor.addLandmark.mutationOptions({
    onSuccess: (l) => {
      refresh();
      setDraft(draftOf(l));
      setSelected(new Set([pinKey('landmark', l.id)]));
      toast({ title: t('console.mapedit_added_toast', { name: l.name_ar }), tone: 'ok' });
    },
  }));
  const edit = useMutation(trpc.ops.mapEditor.editLandmark.mutationOptions({
    onSuccess: (l) => {
      refresh();
      setDraft((d) => (d?.id === l.id ? draftOf(l) : d));
      toast({ title: t('console.mapedit_saved_toast', { name: l.name_ar }), tone: 'ok' });
    },
    onError: fail,
  }));
  const move = useMutation(trpc.ops.mapEditor.movePins.mutationOptions({
    onSuccess: (layers, input) => {
      qc.setQueryData(trpc.ops.mapEditor.layers.queryKey({ cityId: CITY_ID }), layers);
      refresh();
      toast({ title: input.moves.length > 1 ? t('console.mapedit_moved_many_toast', { n: input.moves.length }) : t('console.mapedit_moved_toast'), tone: 'ok' });
    },
    // A refused drop (outside the town) snaps the pin back.
    onError: (e) => {
      fail(e);
      refresh();
    },
  }));
  const merge = useMutation(trpc.ops.mapEditor.merge.mutationOptions({ onSuccess: () => refresh() }));
  const undo = useMutation(trpc.ops.mapEditor.undo.mutationOptions({
    onSuccess: (e) => {
      refresh();
      toast({ title: t('console.mapedit_undone_toast', { summary: e.summaryAr }), tone: 'ok' });
    },
    onError: fail,
  }));
  const decide = useMutation(trpc.ops.mapEditor.decide.mutationOptions({
    onSuccess: (inbox, input) => {
      qc.setQueryData(trpc.ops.mapEditor.inbox.queryKey({ cityId: CITY_ID }), inbox);
      refresh();
      setPick(null);
      setAdjusting(false);
      setAdjustPin(null);
      toast({ title: input.decision === 'accept' ? t('console.mapedit_accepted_toast') : t('console.mapedit_rejected_toast'), tone: 'ok' });
    },
  }));

  const byKey = useMemo(() => {
    const m = new Map<string, EditorPin>();
    for (const p of [...restaurantPins(data.restaurants, canEdit), ...landmarkPins(data.landmarks, canEdit)]) m.set(p.key, p);
    return m;
  }, [data, canEdit]);

  // ── what the map draws for this layer ──
  const inbox = inboxQ.data;
  const dupes = useMemo(() => (inbox?.duplicates ?? []).filter((d) => !notSame.has(dupeKey(d))), [inbox, notSame]);
  const counts = { road: inbox?.counts.driver ?? 0, shops: inbox?.counts.merchant ?? 0, dupes: dupes.length };
  const reviewPins = useMemo((): EditorPin[] => {
    if (!pick) return [];
    if (pick.kind === 'dupe') {
      const { keep, drop } = pick.dupe;
      return [
        { key: 'review:drop', kind: 'landmark', id: drop.id, name: drop.name_ar, pin: drop.pin, category: drop.category, tone: 'before', draggable: false, renamable: false },
        { key: 'review:keep', kind: 'landmark', id: keep.id, name: keep.name_ar, pin: keep.pin, category: keep.category, tone: 'place', draggable: false, renamable: false },
      ];
    }
    const c = pick.card;
    const category = c.target?.kind === 'restaurant' ? ('restaurant' as const) : (data.landmarks.find((l) => l.id === c.target?.id)?.category ?? 'other');
    const name = c.target?.name ?? c.proposedName ?? '';
    const out: EditorPin[] = [];
    if (c.currentPin) out.push({ key: 'review:before', kind: c.target?.kind ?? 'landmark', id: c.target?.id ?? '', name, pin: c.currentPin, category, tone: c.proposedPin ? 'before' : 'place', draggable: false, renamable: false });
    const after = adjustPin ?? c.proposedPin;
    if (after) out.push({ key: 'review:after', kind: c.target?.kind ?? 'landmark', id: c.target?.id ?? '', name: c.kind === 'new_place' ? (c.proposedName ?? '') : name, pin: after, category, tone: 'after', draggable: canEdit && adjusting, renamable: false });
    return out;
  }, [pick, adjustPin, adjusting, canEdit, data.landmarks]);

  // Only a new place's draft draws a pin; editing an existing one must not rebuild the map's pins.
  const newDraft = draft && !draft.id ? draft : null;
  const draftPin = useMemo(
    (): EditorPin | null => (newDraft ? { key: DRAFT_KEY, kind: 'landmark', id: '', name: newDraft.name_ar || t('console.mapedit_new_landmark'), pin: newDraft.pin, category: newDraft.category, tone: 'after', draggable: true, renamable: false } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only by what the pin shows
    [newDraft?.name_ar, newDraft?.pin, newDraft?.category],
  );
  const pins = useMemo((): EditorPin[] | undefined => {
    if (layer === 'zones') return undefined;
    if (layer === 'review') return reviewPins;
    const base = layer === 'restaurants' ? restaurantPins(data.restaurants, canEdit) : landmarkPins(data.landmarks, canEdit);
    if (draftPin) base.push(draftPin);
    return base;
  }, [layer, reviewPins, data, canEdit, draftPin]);

  const link = useMemo(() => {
    if (layer !== 'review' || pick?.kind !== 'card') return null;
    const to = adjustPin ?? pick.card.proposedPin;
    return pick.card.currentPin && to ? { from: pick.card.currentPin, to } : null;
  }, [layer, pick, adjustPin]);

  // ── picking ──
  const inspectKey = selected.size === 1 ? [...selected][0]! : null;
  const inspected = inspectKey ? byKey.get(inspectKey) : undefined;
  const openLandmark = useCallback((id: string, fly: boolean) => {
    const l = data.landmarks.find((x) => x.id === id);
    if (!l) return;
    setSelected(new Set([pinKey('landmark', id)]));
    setDraft(draftOf(l));
    if (fly) setFocus({ key: `landmark:${id}:${Date.now()}`, points: [l.pin] });
  }, [data.landmarks]);
  const openRestaurant = useCallback((orgId: string, fly: boolean) => {
    const r = data.restaurants.find((x) => x.orgId === orgId);
    if (!r) return;
    setSelected(new Set([pinKey('restaurant', orgId)]));
    setPlacing(null);
    if (fly && r.pin) setFocus({ key: `restaurant:${orgId}:${Date.now()}`, points: [r.pin] });
  }, [data.restaurants]);

  const onPinPick = useCallback((key: string, additive: boolean) => {
    if (layer === 'review' || key === DRAFT_KEY) return;
    const p = byKey.get(key);
    if (!p) return;
    if (additive) {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setDraft(null);
      return;
    }
    if (p.kind === 'landmark') openLandmark(p.id, false);
    else openRestaurant(p.id, false);
  }, [layer, byKey, openLandmark, openRestaurant]);

  const onPinDrop = useCallback((key: string, to: LatLng) => {
    if (key === 'review:after') {
      setAdjustPin(to);
      return;
    }
    if (key === DRAFT_KEY) {
      setDraft((d) => (d ? { ...d, pin: to } : d));
      return;
    }
    if (!pins) return;
    const moves = groupMove(pins, selected, key, to);
    if (moves.length > 0) move.mutate({ cityId: CITY_ID, moves });
  }, [pins, selected, move]);

  const onRename = useCallback((key: string, name: string) => {
    const p = byKey.get(key);
    if (p?.kind === 'landmark') edit.mutate({ cityId: CITY_ID, id: p.id, name_ar: name });
  }, [byKey, edit]);

  const onAddAt = useCallback((at: LatLng, screen: { x: number; y: number }) => {
    if (!canEdit || layer === 'review') return;
    setAddAt({ at, screen });
  }, [canEdit, layer]);

  const startLandmark = useCallback((category: LandmarkCategory) => {
    if (!addAt) return;
    setLayer('landmarks');
    setSelected(new Set());
    setDraft({ name_ar: '', aliases: '', category, pin: addAt.at, hidden: false });
    setAddAt(null);
  }, [addAt, setLayer]);

  const onMapClick = useCallback((at: LatLng) => {
    if (!placing) return;
    move.mutate({ cityId: CITY_ID, moves: [{ kind: 'restaurant', id: placing, pin: at }] }, { onSuccess: () => setPlacing(null) });
  }, [placing, move]);

  const onBoxSelect = useCallback((keys: string[]) => {
    if (layer !== 'restaurants' && layer !== 'landmarks') return;
    setSelected(new Set(keys));
    setDraft(null);
  }, [layer]);

  // Esc lets go of everything picked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input,textarea')) return;
      setSelected(new Set());
      setPlacing(null);
      setAddAt(null);
      setDraft((d) => (d && !d.id ? null : d));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const name_ar = draft.name_ar.trim();
    const aliases_ar = parseAliases(draft.aliases);
    if (!draft.id) {
      add.mutate({ cityId: CITY_ID, name_ar, aliases_ar, category: draft.category, pin: draft.pin });
      return;
    }
    edit.mutate({ cityId: CITY_ID, id: draft.id, name_ar, aliases_ar, category: draft.category, hidden: draft.hidden });
  }, [draft, add, edit]);

  // ── review ──
  const pickReview = useCallback((p: ReviewPick) => {
    setPick(p);
    setAdjusting(false);
    setAdjustPin(null);
    const points = p.kind === 'dupe' ? [p.dupe.keep.pin, p.dupe.drop.pin] : [p.card.currentPin, p.card.proposedPin].filter((x): x is LatLng => x !== null);
    setFocus({ key: `${reviewKey(p)}:${Date.now()}`, points });
  }, []);
  const acceptPick = useCallback(() => {
    if (pick?.kind !== 'card') return;
    decide.mutate({ cityId: CITY_ID, reportIds: pick.card.reportIds, decision: 'accept', ...(adjustPin ? { pin: adjustPin } : {}) });
  }, [pick, adjustPin, decide]);
  const rejectPick = useCallback(() => {
    if (pick?.kind !== 'card') return;
    decide.mutate({ cityId: CITY_ID, reportIds: pick.card.reportIds, decision: 'reject' });
  }, [pick, decide]);
  const mergePick = useCallback(() => {
    if (pick?.kind !== 'dupe') return;
    const { keep, drop } = pick.dupe;
    merge.mutate({ cityId: CITY_ID, keepId: keep.id, dropId: drop.id }, {
      onSuccess: () => {
        setPick(null);
        toast({ title: t('console.mapedit_merged_toast', { drop: drop.name_ar, keep: keep.name_ar }), tone: 'ok' });
      },
    });
  }, [pick, merge, toast]);
  const notSamePick = useCallback(() => {
    if (pick?.kind !== 'dupe') return;
    const next = new Set(notSame).add(dupeKey(pick.dupe));
    setNotSame(next);
    writeNotSame(next);
    setPick(null);
  }, [pick, notSame]);

  // ── panels ──
  const loading = layersQ.isPending;
  const aside =
    layer === 'restaurants' ? (
      <RestaurantList items={data.restaurants} loading={loading} selected={selected} onPick={(id) => openRestaurant(id, true)} />
    ) : layer === 'landmarks' ? (
      <LandmarkList items={data.landmarks} loading={loading} selected={selected} onPick={(id) => openLandmark(id, true)} />
    ) : layer === 'review' ? (
      <ReviewList tab={reviewTab} onTab={(tab) => {
          setReviewTab(tab);
          setPick(null);
        }} cards={inbox?.cards ?? []} dupes={dupes} counts={counts} loading={inboxQ.isPending} picked={pick ? reviewKey(pick) : null} onPick={pickReview} />
    ) : null;

  const inspectedLandmark = draft?.id ? (data.landmarks.find((l) => l.id === draft.id) ?? null) : null;
  const inspectedRestaurant = inspected?.kind === 'restaurant' ? data.restaurants.find((r) => r.orgId === inspected.id) : selected.size === 1 && inspectKey?.startsWith('restaurant:') ? data.restaurants.find((r) => pinKey('restaurant', r.orgId) === inspectKey) : undefined;
  const overlay = (
    <>
      {layer === 'landmarks' && draft && (selected.size <= 1) ? (
        <LandmarkInspector
          draft={draft}
          landmark={inspectedLandmark}
          canEdit={canEdit}
          saving={add.isPending || edit.isPending}
          error={add.error ? errorText(add.error) : null}
          onChange={setDraft}
          onSave={saveDraft}
          onClose={() => {
            setDraft(null);
            setSelected(new Set());
          }}
        />
      ) : null}
      {layer === 'restaurants' && inspectedRestaurant ? (
        <RestaurantInspector restaurant={inspectedRestaurant} canEdit={canEdit} placing={placing === inspectedRestaurant.orgId} onPlace={() => setPlacing((p) => (p === inspectedRestaurant.orgId ? null : inspectedRestaurant.orgId))} onClose={() => setSelected(new Set())} />
      ) : null}
      {addAt ? <AddMenu at={addAt.screen} onPick={startLandmark} onZone={() => { onAddZone(addAt.at); setAddAt(null); }} onClose={() => setAddAt(null)} /> : null}
      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} edits={historyQ.data ?? []} loading={historyQ.isPending} undoing={undo.isPending ? (undo.variables?.editId ?? null) : null} onUndo={(editId) => undo.mutate({ cityId: CITY_ID, editId })} />
    </>
  );

  const footer =
    layer === 'review' ? (
      <ReviewBar
        pick={pick}
        canEdit={canEdit}
        adjusting={adjusting}
        busy={decide.isPending || merge.isPending}
        error={decide.error ? errorText(decide.error) : merge.error ? errorText(merge.error) : null}
        onAccept={acceptPick}
        onReject={rejectPick}
        onAdjust={() => setAdjusting((a) => !a)}
        onMerge={mergePick}
        onNotSame={notSamePick}
      />
    ) : layer === 'restaurants' || layer === 'landmarks' ? (
      <>
        <p className="min-w-0 text-sm text-muted">{selected.size > 1 ? t('console.mapedit_move_together') : canEdit ? t('console.mapedit_tips') : ''}</p>
        {selected.size > 1 ? (
          <div className="ms-auto flex items-center gap-2">
            <Chip tone="live">{t('console.mapedit_selected_n', { n: selected.size })}</Chip>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('console.mapedit_clear_selection')}</Button>
          </div>
        ) : null}
      </>
    ) : null;

  const tools = (
    <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)}>
      {t('console.mapedit_history')}
    </Button>
  );

  return {
    pins,
    selectedPins: selected,
    link,
    focus,
    placing: placing !== null,
    aside,
    footer,
    overlay,
    tools,
    reviewCount: counts.road + counts.shops + counts.dupes,
    onPinPick,
    onPinDrop,
    onRename,
    onAddAt,
    onMapClick,
    onBoxSelect,
  };
}
