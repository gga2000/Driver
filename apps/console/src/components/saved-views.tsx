'use client';

import { t } from '@driver/i18n';
import { useEffect, useId, useState } from 'react';
import { PREF_KEYS, readJson, writeJson } from '@/lib/prefs';
import { addView, MAX_NAME, parseViews, removeView, sameParams, trimParams, type SavedView } from '@/lib/saved-views';
import type { LinkParams } from '@/lib/url-state';
import { Button, cx, IconClose, IconPlus, Input, useToast } from './ui';

/**
 * The orders page's "عروضي" row (o5): one tap opens a list the viewer named earlier, "احفظ هذا
 * العرض" names the list on screen. Kept on this device only; nothing shows until there is a view
 * or something worth saving.
 */
export function SavedViewsBar({ current, defaults, suggest, onOpen }: { current: LinkParams; defaults: LinkParams; suggest: () => string; onOpen: (params: LinkParams) => void }) {
  const toast = useToast();
  const nameId = useId();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  // Read after mount: the server render has no storage.
  useEffect(() => setViews(parseViews(readJson<unknown>(PREF_KEYS.orderViews, []))), []);
  const store = (next: SavedView[]) => {
    setViews(next);
    writeJson(PREF_KEYS.orderViews, next);
  };

  const plain = Object.keys(trimParams(current, defaults)).length === 0;
  const active = views.find((v) => sameParams(v.params, current, defaults));
  const canSave = !plain && !active;
  if (views.length === 0 && !canSave && naming === null) return null;

  const save = () => {
    if (naming === null || !naming.trim()) return;
    store(addView(views, naming, current, defaults, `v${Date.now().toString(36)}`));
    toast({ title: t('console.orders_saved_done', { name: naming.trim().slice(0, MAX_NAME) }), tone: 'ok' });
    setNaming(null);
  };
  const remove = (view: SavedView) => {
    const before = views;
    store(removeView(views, view.id));
    toast({ title: t('console.orders_saved_removed', { name: view.name }), action: { label: t('console.cancel'), onClick: () => store(before) } });
  };

  return (
    <div role="group" aria-label={t('console.orders_saved_label')} className="mb-3 flex flex-wrap items-center gap-2" data-testid="saved-views">
      {views.length > 0 && (
        <span className="text-dense font-medium text-muted" title={t('console.orders_saved_device')}>
          {t('console.orders_saved_label')}
        </span>
      )}
      {views.map((v) => {
        const on = v.id === active?.id;
        return (
          <span key={v.id} className={cx('inline-flex h-8 max-w-[14rem] items-center rounded-full border text-dense transition-colors', on ? 'border-accent-text/60 bg-accent-wash font-medium text-text' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text')}>
            <button type="button" aria-pressed={on} onClick={() => onOpen(v.params)} title={v.name} className="h-full min-w-0 truncate rounded-s-full ps-3 pe-1.5">
              {v.name}
            </button>
            <button type="button" onClick={() => remove(v)} aria-label={t('console.orders_saved_remove', { name: v.name })} title={t('console.orders_saved_remove', { name: v.name })} className="grid h-full w-7 shrink-0 place-items-center rounded-e-full text-faint hover:text-bad">
              <IconClose size={13} />
            </button>
          </span>
        );
      })}
      {naming !== null ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor={nameId} className="sr-only">
            {t('console.orders_saved_name')}
          </label>
          <Input
            id={nameId}
            autoFocus
            maxLength={MAX_NAME}
            className="h-8 w-56 text-dense"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null);
            }}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!naming.trim()}>
            {t('console.save')}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(null)}>
            {t('console.cancel')}
          </Button>
        </form>
      ) : canSave ? (
        <Button size="sm" variant="ghost" onClick={() => setNaming(suggest())} title={t('console.orders_saved_device')}>
          <IconPlus size={14} />
          {t('console.orders_saved_save')}
        </Button>
      ) : null}
    </div>
  );
}
