'use client';

import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatAreaKm2,
  ZONE_EDIT_ROLES,
  zoneProblemText,
  zoneServiceBounds,
  zoneShapeProblem,
  type ZonePlacement,
  type ZonePlacementView,
  type ZoneShapeProblem,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import { TIERS_IN_ORDER } from '@driver/map';
import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { isTypingTarget } from '@/lib/hotkeys';
import { tierLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useTheme } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { closedEditor, editorReducer, isDirty, type EditorState } from '@/lib/zone-editor';
import { Button, Chip, cx, NeedLogin, PageHeader, QueryError, Skeleton, useToast, type ChipTone } from './ui';

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

  const save = useMutation(
    trpc.ops.zones.place.mutationOptions({
      onSuccess: (z) => {
        void qc.invalidateQueries({ queryKey: trpc.ops.zones.list.queryKey() });
        toast({ title: t('console.zones_saved_toast', { name: z.name_ar }), tone: 'ok' });
        dispatch({ type: 'open', key: z.key, ring: z.ring, centre: z.centre });
      },
    }),
  );

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
    if (!canEdit) return;
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
  }, [canEdit, editor.key, editor.selected]);

  if (!signedIn) {
    return (
      <div className="px-4 py-6 lg:px-8">
        <PageHeader title={t('console.zones_title')} subtitle={t('console.zones_subtitle')} />
        <NeedLogin />
      </div>
    );
  }

  return (
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
      map={<ZonesMapCanvas theme={theme} zones={zones} editor={editor} editable={canEdit} invalid={problem !== null} dispatch={dispatch} onPick={pick} />}
    />
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
  map: ReactNode;
}

/** The page without data fetching: header, zone list, map slot and the edit toolbar. */
export function ZonesBoard(p: ZonesBoardProps) {
  const placed = p.zones.filter((z) => z.placement !== 'draft').length;
  const open = p.editor.key ? p.zones.find((z) => z.key === p.editor.key) : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5 lg:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-7">{t('console.zones_title')}</h1>
          <p className="max-w-[68ch] text-sm text-muted">{t('console.zones_subtitle')}</p>
        </div>
        {p.zones.length > 0 ? (
          <Chip tone={placed === p.zones.length ? 'done' : 'warn'} dot>
            {t('console.zones_progress', { n: placed, total: p.zones.length })}
          </Chip>
        ) : null}
        {!p.canEdit ? <Chip>{t('console.zones_read_only')}</Chip> : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-e border-line bg-surface" aria-label={t('console.zones_title')}>
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
                        <button
                          type="button"
                          onClick={() => p.onPick(z.key)}
                          aria-current={z.key === p.editor.key ? 'true' : undefined}
                          className={cx(
                            'flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-2',
                            z.key === p.editor.key && 'bg-accent-tint',
                          )}
                        >
                          <span className="min-w-0 truncate">{z.name_ar}</span>
                          <Chip size="sm" tone={STATE_TONE[z.placement]}>
                            {stateLabel(z.placement)}
                          </Chip>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">{p.map}</div>
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-2.5">
            {open ? (
              <>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{open.name_ar}</span>
                    <Chip size="sm">{t('console.zones_area', { area: formatAreaKm2(open.areaM2) })}</Chip>
                    <Chip size="sm" tone={STATE_TONE[open.placement]}>
                      {stateLabel(open.placement)}
                    </Chip>
                    {open.placedBy ? <span className="text-xs text-muted">{t('console.zones_placed_by', { name: open.placedBy })}</span> : null}
                  </div>
                  <p role="status" className={cx('mt-0.5 text-sm', p.problemText || p.saveError ? 'text-bad' : p.dirty ? 'text-warn' : 'text-muted')}>
                    {p.saveError ?? p.problemText ?? (p.dirty ? t('console.zones_unsaved') : p.canEdit ? t('console.zones_help') : '')}
                  </p>
                </div>
                {p.canEdit ? (
                  <div className="ms-auto flex flex-wrap items-center gap-2">
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
