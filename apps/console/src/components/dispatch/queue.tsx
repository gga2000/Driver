'use client';

import type { BoardCard, VehicleClass } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useRef } from 'react';
import type { BoardColumn } from '@/lib/board';
import { QUEUE_ORDER, roadKm, waitTone, type Candidate, type Queue } from '@/lib/dispatch';
import { formatCountdown, shortId } from '@/lib/format';
import { offerStateLabel, verticalLabel, zoneName } from '@/lib/labels';
import { markerStateForPin } from '@/lib/live-map';
import { orderLabel, personText, useNames } from '@/lib/names';
import { CashLine, StateGlyph, WavePips } from '../map-cards';
import { OrgName, PersonName } from '../named';
import { TRIP_DRAG_TYPE } from '../live-map-canvas';
import { Button, Chip, cx, IconChevronDown, Kbd } from '../ui';
import { BLOCKER_KEY } from './assign';

const SECTION_KEY: Record<BoardColumn, MessageKey> = {
  needs_dispatcher: 'console.col_needs_dispatcher',
  offered: 'console.col_offered',
  searching: 'console.col_searching',
  assigned: 'console.col_assigned',
};

export interface QueueProps {
  queue: Queue;
  collapsed: ReadonlySet<BoardColumn>;
  onToggle: (col: BoardColumn) => void;
  selected: string | null;
  onSelect: (tripId: string | null) => void;
  ordersOf: (tripId: string) => readonly string[];
  merchantOf: (tripId: string) => string | null;
  vehicles: ReadonlyMap<string, VehicleClass>;
  tick: number;
  candidates: readonly Candidate[];
  pick: number;
  onPick: (i: number) => void;
  onSend: () => void;
  sending: boolean;
  onOther: () => void;
  dim: boolean;
}

/**
 * The queue (K-03): sections top to bottom by who needs a hand — يحتاج موزّع, معروض, يبحث, then مُعيَّن
 * (collapsed). The selected card opens in place with its five best drivers, numbered for the keys.
 */
export function DispatchQueue(p: QueueProps) {
  return (
    <div className={cx('min-h-0 flex-1 overflow-y-auto transition-opacity', p.dim && 'opacity-60')} aria-busy={p.dim}>
      {QUEUE_ORDER.map((col) => {
        const cards = p.queue[col];
        const open = !p.collapsed.has(col);
        const loud = col === 'needs_dispatcher' && cards.length > 0;
        return (
          <section key={col} aria-labelledby={`q-${col}`}>
            <h2 id={`q-${col}`} className="sticky top-0 z-10">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => p.onToggle(col)}
                className={cx(
                  'flex h-11 w-full items-center gap-2 border-b px-4 text-start text-sm font-semibold backdrop-blur',
                  loud ? 'border-bad/30 bg-bad-tint/95 text-bad' : 'border-line bg-surface/95 text-text',
                )}
              >
                <IconChevronDown size={16} className={cx('shrink-0 text-muted transition-transform', !open && 'rotate-90')} />
                <span className="flex-1">{t(SECTION_KEY[col])}</span>
                <span className={cx('num inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-xs', loud ? 'bg-bad-solid text-on-bad' : 'bg-surface-3 text-muted')}>{cards.length}</span>
              </button>
            </h2>
            {open && cards.length === 0 ? <p className="border-b border-line px-4 py-2.5 text-dense text-faint">{t(col === 'needs_dispatcher' ? 'console.q_needs_empty' : 'console.col_empty')}</p> : null}
            {open && cards.length > 0 ? (
              <ul className="divide-y divide-line border-b border-line">
                {cards.map((card) => (
                  <li key={card.tripId}>
                    <QueueCard card={card} {...p} isSelected={p.selected === card.tripId} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function QueueCard({
  card,
  isSelected,
  onSelect,
  ordersOf,
  merchantOf,
  vehicles,
  tick,
  candidates,
  pick,
  onPick,
  onSend,
  sending,
  onOther,
}: QueueProps & { card: BoardCard; isSelected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const orderIds = ordersOf(card.tripId);
  const merchant = merchantOf(card.tripId);
  const elapsed = card.elapsedSec + tick;
  const tone = waitTone(card, elapsed);
  const open = card.offers.filter((o) => o.state === 'sent' || o.state === 'seen');
  const countdown = card.countdownSec === null ? null : Math.max(0, card.countdownSec - tick);

  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  return (
    <div
      ref={ref}
      data-card={card.tripId}
      className={cx(
        'relative border-s-[3px] transition-colors',
        tone === 'bad' ? 'border-s-bad-solid' : tone === 'warn' ? 'border-s-warn-solid' : 'border-s-transparent',
        isSelected ? 'bg-accent-wash' : 'hover:bg-surface-2',
      )}
    >
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TRIP_DRAG_TYPE, card.tripId);
          e.dataTransfer.effectAllowed = 'move';
          onSelect(card.tripId);
        }}
        aria-expanded={isSelected}
        onClick={() => onSelect(isSelected ? null : card.tripId)}
        onKeyDown={(e) => {
          // Click a card, press 2, press Enter: the offer goes out (the card doesn't fold).
          if (e.key === 'Enter' && isSelected && pick >= 0) {
            e.preventDefault();
            onSend();
          }
        }}
        className="block w-full cursor-grab px-4 py-2.5 text-start active:cursor-grabbing"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="num shrink-0 text-[15px] font-bold text-text">{orderIds.length ? orderIds.map(orderLabel).join(' ') : verticalLabel(card.vertical)}</span>
            {merchant ? (
              <span className="min-w-0 truncate text-sm text-text">
                <OrgName id={merchant} copy={false} />
              </span>
            ) : null}
          </span>
          <span className={cx('num shrink-0 text-[15px] font-semibold', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-muted')} title={t('console.card_elapsed', { time: formatCountdown(elapsed) })}>
            {formatCountdown(elapsed)}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
          <span>{verticalLabel(card.vertical)}</span>
          <span aria-hidden>·</span>
          <span>{zoneName(card.zoneId)}</span>
          {card.wave + card.pass > 0 ? (
            <>
              <span aria-hidden>·</span>
              <WavePips card={card} />
            </>
          ) : null}
          {card.compensationLabel_ar ? (
            <Chip size="sm" tone="ready" className="ms-auto">
              {card.compensationLabel_ar}
            </Chip>
          ) : null}
        </span>
        {/* The section already says the state; the server's words (why it needs a human) show once opened. */}
        {card.status !== 'assigned' && (isSelected || card.customerMayCancelFree) ? (
          <span className="mt-0.5 block text-xs text-text">
            {isSelected ? card.status_ar : null}
            {card.customerMayCancelFree ? (
              <span className="font-medium text-bad">
                {isSelected ? ' · ' : ''}
                {t('console.card_free_cancel')}
              </span>
            ) : null}
          </span>
        ) : null}
        {card.assignedDriverId ? (
          <span className="mt-1 block text-xs text-muted">
            {t('console.q_driver')}{' '}
            <span className="font-medium text-text">
              <PersonName id={card.assignedDriverId} vehicle vehicleClass={vehicles.get(card.assignedDriverId)} copy={false} />
            </span>
          </span>
        ) : null}
        {open.length > 0 && !card.assignedDriverId ? (
          <span className="mt-1 block text-xs text-muted">
            {open.slice(0, 2).map((o) => (
              <span key={o.offerId} className="me-3 inline-flex items-center gap-1">
                <span className="font-medium text-text">
                  <PersonName id={o.driverId} copy={false} />
                </span>
                {offerStateLabel(o.state)} · <span className="num">{t('console.offer_expires', { seconds: Math.max(0, o.expiresInSec - tick) })}</span>
              </span>
            ))}
          </span>
        ) : null}
        {countdown !== null && card.status !== 'assigned' && card.status !== 'needs_dispatcher' ? (
          <span className="num mt-0.5 block text-xs text-faint">{t('console.card_countdown', { time: formatCountdown(countdown) })}</span>
        ) : null}
      </button>

      {isSelected ? <Candidates card={card} candidates={candidates} pick={pick} onPick={onPick} onSend={onSend} sending={sending} onOther={onOther} /> : null}
    </div>
  );
}

function Candidates({
  card,
  candidates,
  pick,
  onPick,
  onSend,
  sending,
  onOther,
}: {
  card: BoardCard;
  candidates: readonly Candidate[];
  pick: number;
  onPick: (i: number) => void;
  onSend: () => void;
  sending: boolean;
  onOther: () => void;
}) {
  const picked = pick >= 0 ? candidates[pick] : undefined;
  const names = useNames({ people: candidates.map((c) => c.driverId) });
  const pickedName = picked ? (personText(picked.driverId, names.person(picked.driverId)) ?? shortId(picked.driverId)) : '';
  return (
    <div className="px-4 pb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted">{card.assignedDriverId ? t('console.q_reassign_to') : t('console.q_best')}</h3>
        <span className="text-xs text-faint">{t('console.q_keys_hint')}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-dense text-muted">{t('console.q_no_candidates')}</p>
      ) : (
        <ol aria-label={t('console.q_best')} className="overflow-hidden rounded-md border border-line bg-surface">
          {candidates.map((c, i) => (
            <li key={c.driverId} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(i)}
                onKeyDown={(e) => {
                  // Enter on the picked row sends, like Enter anywhere else on the desk.
                  if (e.key === 'Enter' && i === pick) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                aria-pressed={i === pick}
                className={cx('grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2.5 py-2 text-start', i === pick ? 'bg-accent-tint' : 'hover:bg-surface-2')}
              >
                {i === pick ? (
                  <kbd className="num inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] bg-accent font-sans text-xs font-bold text-on-accent">{i + 1}</kbd>
                ) : i < 5 ? (
                  <Kbd className="h-6 min-w-6 text-xs">{i + 1}</Kbd>
                ) : (
                  <span className="min-w-6" />
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {c.pin ? <StateGlyph state={markerStateForPin(c.pin.state)} size={13} /> : null}
                    <span className="min-w-0 truncate">
                      <PersonName id={c.driverId} vehicle vehicleClass={c.pin?.vehicleClass} copy={false} />
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                    {c.km !== null ? <span className="num">{t('console.q_km_eta', { km: roadKm(c.km).toFixed(1), min: c.etaMin ?? 1 })}</span> : <span>{t('console.q_no_position')}</span>}
                    {c.suggested ? <span className="text-accent-text">{t('console.q_suggested')}</span> : null}
                    {c.declined ? <span>{t('console.q_declined')}</span> : null}
                    {c.blockers.map((b) => (
                      <span key={b} className="font-medium text-bad">
                        {t(BLOCKER_KEY[b])}
                      </span>
                    ))}
                  </span>
                </span>
                {c.pin ? <CashLine pin={c.pin} compact /> : <span />}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button variant={picked?.blockers.length ? 'danger' : 'primary'} size="md" className="min-w-0 flex-1" disabled={!picked} loading={sending} onClick={onSend} kbd={picked ? '↵' : undefined}>
          <span className="truncate">{picked ? t(picked.blockers.length ? 'console.q_send_force' : 'console.q_send', { name: pickedName }) : t('console.q_pick_first')}</span>
        </Button>
        <Button variant="ghost" onClick={onOther}>
          {t('console.q_other')}
        </Button>
      </div>
    </div>
  );
}
