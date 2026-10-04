'use client';

import { orderTicketNumber, type TicketSummary } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useRef, useState } from 'react';
import { ageLabel } from '@/lib/control-room';
import { formatIqd } from '@/lib/format';
import { isUnread, SUPPORT_VIEWS, type SeenMap, type SupportView } from '@/lib/support-views';
import {
  Chip,
  cx,
  EmptyState,
  IconButton,
  IconCheckCircle,
  IconChevronDown,
  IconPlus,
  IconSearch,
  Input,
  Kbd,
  Popover,
  Skeleton,
} from '../ui';
import { ChannelIcon, SlaPill, statusTone } from './sla';

/**
 * The queue pane: smart views, search, and the tickets in urgency order. A row is two lines — the
 * subject (bold while unread) and who/what/when — with the SLA fuse at the end edge. The selected
 * row is a warm wash with an orange edge. Arrow keys / j k move; Enter opens.
 */
export function SupportQueue({
  rows,
  counts,
  view,
  onView,
  query,
  onQuery,
  selectedId,
  onSelect,
  onNew,
  now,
  seen,
  loading = false,
  live,
}: {
  rows: TicketSummary[];
  counts: Record<SupportView, number> | null;
  view: SupportView;
  onView: (v: SupportView) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  now: Date;
  seen: SeenMap;
  loading?: boolean;
  live?: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const allClear = !loading && rows.length === 0 && view === 'open' && !query;
  return (
    <section
      aria-label={t('console.sup_title')}
      className="flex h-full min-h-0 flex-col border-e border-line bg-surface"
    >
      <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">{t('console.sup_title')}</h1>
          <div className="flex items-center gap-1">
            {live}
            <IconButton label={t('console.sup_new')} variant="secondary" size="sm" onClick={onNew}>
              <IconPlus size={16} />
            </IconButton>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ViewMenu view={view} counts={counts} onView={onView} />
          <div className="min-w-0 flex-1">
            <Input
              leading={<IconSearch size={16} />}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('console.sup_search_placeholder')}
              aria-label={t('console.sup_search')}
              className="h-8 text-dense"
            />
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label={t(`console.sup_view_${view}` as MessageKey)}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {loading && rows.length === 0
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2 border-b border-line/70 px-4 py-3.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          : null}
        {allClear ? (
          <EmptyState
            bare
            icon={<IconCheckCircle size={20} />}
            title={t('console.sup_empty_clear')}
            hint={t('console.sup_empty_clear_hint')}
            className="py-16"
          />
        ) : !loading && rows.length === 0 ? (
          <EmptyState
            bare
            title={t('console.sup_empty_view')}
            hint={t('console.sup_empty_view_hint')}
            className="py-16"
          />
        ) : null}
        {rows.map((r) => (
          <QueueRow
            key={r.id}
            row={r}
            selected={r.id === selectedId}
            unread={isUnread(r, seen)}
            now={now}
            onSelect={() => onSelect(r.id)}
          />
        ))}
      </div>
    </section>
  );
}

function QueueRow({
  row: r,
  selected,
  unread,
  now,
  onSelect,
}: {
  row: TicketSummary;
  selected: boolean;
  unread: boolean;
  now: Date;
  onSelect: () => void;
}) {
  const who = r.customerName ?? t('console.sup_customer');
  const reason = r.urgencyReasons[0];
  return (
    <div
      role="option"
      aria-selected={selected}
      data-ticket-row
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cx(
        'relative cursor-pointer border-b border-line/70 px-4 py-3 transition-colors duration-fast',
        selected ? 'bg-accent-wash' : 'hover:bg-surface-2',
      )}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-accent" />
      ) : null}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cx('h-2 w-2 shrink-0 rounded-pill', unread ? 'bg-accent' : 'bg-transparent')}
        />
        {unread ? <span className="sr-only">{t('console.sup_unread')}</span> : null}
        <p
          className={cx(
            'min-w-0 flex-1 truncate text-sm',
            unread ? 'font-bold text-text' : 'font-medium text-text',
          )}
        >
          {r.subject}
        </p>
        <span className="num shrink-0 text-xs text-faint">{ageLabel(r.lastActivityAt, now)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 ps-4">
        <ChannelIcon channel={r.channel} size={14} className="shrink-0 text-muted" />
        <p className="min-w-0 flex-1 truncate text-dense text-muted">
          <span className="text-text">{who}</span>
          {r.orderId ? (
            <>
              <span aria-hidden> · </span>
              <bdi className="num">#{orderTicketNumber(r.orderId)}</bdi>
            </>
          ) : null}
          {reason ? (
            <>
              <span aria-hidden> · </span>
              <span
                className={
                  r.urgency >= 60 ? 'font-medium text-bad' : r.urgency >= 30 ? 'text-warn' : ''
                }
              >
                {reason}
              </span>
            </>
          ) : null}
        </p>
        <SlaPill row={r} now={now} size="sm" />
      </div>
      {r.status !== 'open' || r.refundedIqd > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 ps-4">
          {r.status !== 'open' ? (
            <Chip tone={statusTone(r.status)} size="sm">
              {r.status_ar}
            </Chip>
          ) : null}
          {r.refundedIqd > 0 ? (
            <span className="num text-[11px] text-ok">
              {t('console.sup_refund_done', { amount: formatIqd(r.refundedIqd) })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "المفتوحة 4 ▾": the current view; the menu lists every view with its count. */
function ViewMenu({
  view,
  counts,
  onView,
}: {
  view: SupportView;
  counts: Record<SupportView, number> | null;
  onView: (v: SupportView) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('console.sup_views')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-dense font-semibold text-text shadow-card hover:bg-surface-2"
      >
        {t(`console.sup_view_${view}` as MessageKey)}
        {counts && view !== 'resolved' ? (
          <span className="num font-medium text-accent-text">{counts[view]}</span>
        ) : null}
        <IconChevronDown size={14} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-56">
        <div role="menu" aria-label={t('console.sup_views')}>
          {SUPPORT_VIEWS.map((v, i) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={v === view}
              onClick={() => {
                onView(v);
                setOpen(false);
              }}
              className={cx(
                'flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-sm',
                v === view ? 'bg-accent-tint font-semibold' : 'hover:bg-surface-2',
              )}
            >
              <span className="flex-1 text-start">{t(`console.sup_view_${v}` as MessageKey)}</span>
              {counts && v !== 'resolved' ? (
                <span
                  className={cx(
                    'num text-xs',
                    v === 'breached' && counts[v] > 0 ? 'font-semibold text-bad' : 'text-muted',
                  )}
                >
                  {counts[v]}
                </span>
              ) : null}
              <Kbd className="opacity-70">{i + 1}</Kbd>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
