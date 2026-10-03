'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardCard, BoardPolicy, Vertical } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BOARD_COLUMNS,
  driversFromBoard,
  groupBoard,
  isRedCard,
  POLICY_MODES,
  policyMode,
  rightNow,
  setPolicyInput,
  type BoardColumn,
  type PolicyMode,
} from '@/lib/board';
import { formatCountdown, shortId } from '@/lib/format';
import { offerStateLabel, verticalLabel, zoneName } from '@/lib/labels';
import { CITY_ID, LIVE_POLL_MS, useActiveTrips, useDispatchBoard } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, primaryBtn, QueryError, useSecondsSince } from './ui';

const COLUMN_KEY = {
  searching: 'console.col_searching',
  offered: 'console.col_offered',
  assigned: 'console.col_assigned',
  needs_dispatcher: 'console.col_needs_dispatcher',
} as const satisfies Record<BoardColumn, string>;

const MODE_KEY = {
  broadcast: 'console.policy_broadcast',
  auto: 'console.policy_auto',
  suggest: 'console.policy_suggest',
  fixed: 'console.policy_fixed',
} as const satisfies Record<PolicyMode, string>;

export function DispatchPage() {
  const signedIn = useSignedIn();
  const board = useDispatchBoard();
  const trips = useActiveTrips();
  const tick = useSecondsSince(board.dataUpdatedAt);
  const [override, setOverride] = useState<{ card: BoardCard; driverId?: string } | null>(null);
  const [sound, setSound] = useState(false);

  const cards = useMemo(() => board.data?.cards ?? [], [board.data]);
  const grouped = useMemo(() => groupBoard(cards), [cards]);
  const now = useMemo(() => rightNow(cards), [cards]);
  const knownDrivers = useMemo(() => driversFromBoard(board.data, trips.data ?? []).map((d) => d.driverId), [board.data, trips.data]);

  useAlertSound(sound, now.needsDispatcher);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.dispatch_title')} subtitle={t('console.dispatch_subtitle')} />
        <NeedLogin />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.dispatch_title')} subtitle={t('console.dispatch_subtitle')}>
        <LiveBadge seconds={LIVE_POLL_MS / 1000} updatedAt={board.dataUpdatedAt} fetching={board.isFetching} />
        <button type="button" className={ghostBtn} aria-pressed={sound} onClick={() => setSound((s) => !s)}>
          {sound ? t('console.sound_on') : t('console.sound_off')}
        </button>
      </PageHeader>

      {board.error && (
        <div className="mb-4">
          <QueryError error={board.error} onRetry={() => void board.refetch()} />
        </div>
      )}

      <RightNowBar now={now} />

      {board.data && <PolicySwitches policies={board.data.policies} />}

      {board.isSuccess && cards.length === 0 && (
        <div className="mt-6">
          <EmptyState title={t('console.board_empty')} hint={t('console.map_empty_hint')} />
        </div>
      )}

      {cards.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {BOARD_COLUMNS.map((col) => (
            <section
              key={col}
              aria-labelledby={`col-${col}`}
              className={`flex min-w-0 flex-col rounded-xl border p-3 ${col === 'needs_dispatcher' && grouped[col].length ? 'border-danger-500 bg-danger-500/5' : 'border-line bg-surface'}`}
            >
              <h2 id={`col-${col}`} className="mb-3 flex items-center justify-between font-display text-base font-semibold">
                {t(COLUMN_KEY[col])}
                <Chip tone={col === 'needs_dispatcher' && grouped[col].length ? 'bad' : 'neutral'}>{grouped[col].length}</Chip>
              </h2>
              {grouped[col].length === 0 ? (
                <p className="text-sm text-faint">{t('console.col_empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {grouped[col].map((card) => (
                    <li key={card.tripId}>
                      <BoardCardView card={card} tick={tick} onAssign={(driverId) => setOverride({ card, ...(driverId ? { driverId } : {}) })} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <OverrideDialog target={override} knownDrivers={knownDrivers} onClose={() => setOverride(null)} />
    </div>
  );
}

// ───────────────────────── right-now bar ─────────────────────────

function RightNowBar({ now }: { now: ReturnType<typeof rightNow> }) {
  const items: [string, string | number, boolean?][] = [
    [t('console.now_searching'), now.searching],
    [t('console.now_offered'), now.offered],
    [t('console.now_assigned'), now.assigned],
    [t('console.now_needs'), now.needsDispatcher, now.needsDispatcher > 0],
    [t('console.now_red'), now.red, now.red > 0],
    [t('console.now_avg_wait'), formatCountdown(now.avgWaitSec)],
    [t('console.now_drivers'), now.activeDrivers],
    [t('console.now_compensated'), now.compensated],
  ];
  return (
    <section aria-label={t('console.now_bar')} className="rounded-xl border border-line bg-surface p-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {items.map(([label, value, bad]) => (
          <div key={label} className={`rounded-lg px-3 py-2 ${bad ? 'bg-danger-500/15' : 'bg-surface-2'}`}>
            <dt className="truncate text-xs text-muted">{label}</dt>
            <dd className={`font-display text-xl font-bold tabular-nums ${bad ? 'text-danger-100' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-faint">{t('console.now_missing')}</p>
    </section>
  );
}

// ───────────────────────── policy switches ─────────────────────────

function PolicySwitches({ policies }: { policies: BoardPolicy[] }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const setPolicy = useMutation(
    trpc.dispatch.setPolicy.mutationOptions({
      onSuccess: (p) => {
        setNotice(t('console.policy_saved', { vertical: verticalLabel(p.vertical), mode: t(MODE_KEY[policyMode(p)]) }));
        void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() });
      },
    }),
  );
  if (policies.length === 0) return <p className="mt-4 text-sm text-muted">{t('console.policy_none')}</p>;
  return (
    <Card title={t('console.policies')} className="mt-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {policies.map((p) => {
          const mode = policyMode(p);
          const busy = setPolicy.isPending && setPolicy.variables?.vertical === p.vertical;
          return (
            <li key={p.vertical} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold">{verticalLabel(p.vertical)}</span>
                {mode === 'fixed' && <Chip>{t('console.policy_fixed')}</Chip>}
                {p.overridden && <Chip tone="warn">{t('console.policy_overridden')}</Chip>}
              </div>
              <div role="radiogroup" aria-label={verticalLabel(p.vertical)} className="flex flex-wrap gap-1">
                {POLICY_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    disabled={busy}
                    onClick={() => mode !== m && setPolicy.mutate(setPolicyInput(CITY_ID, p.vertical as Vertical, m))}
                    className={`rounded-pill border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                      mode === m ? 'border-accent bg-accent font-semibold text-on-accent' : 'border-line bg-surface text-text hover:border-muted'
                    }`}
                  >
                    {t(MODE_KEY[m])}
                  </button>
                ))}
              </div>
              {p.overridden && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPolicy.mutate({ cityId: CITY_ID, vertical: p.vertical, clear: true })}
                  className="mt-2 rounded-md text-xs text-muted underline hover:text-accent"
                >
                  {t('console.policy_reset')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className="mt-2 min-h-[1.25rem] text-xs">
        {setPolicy.error ? <span className="text-bad">{setPolicy.error.message}</span> : <span className="text-muted">{notice}</span>}
      </p>
    </Card>
  );
}

// ───────────────────────── card ─────────────────────────

function BoardCardView({ card, tick, onAssign }: { card: BoardCard; tick: number; onAssign: (driverId?: string) => void }) {
  const red = isRedCard(card);
  const countdown = card.countdownSec === null ? null : Math.max(0, card.countdownSec - tick);
  const openOffers = card.offers.filter((o) => o.state === 'sent' || o.state === 'seen');
  return (
    <article
      aria-label={`${verticalLabel(card.vertical)} · ${zoneName(card.zoneId)} · ${card.status_ar}`}
      className={`rounded-lg border p-3 text-sm ${red ? 'border-danger-500 bg-danger-500/15' : 'border-line bg-surface-2'}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {verticalLabel(card.vertical)} · {zoneName(card.zoneId)}
        </span>
        <span className="flex flex-wrap gap-1">
          {card.compensationLabel_ar && <Chip tone="ready">{card.compensationLabel_ar}</Chip>}
          {red && <Chip tone="bad">{t('console.card_red')}</Chip>}
        </span>
      </header>
      <p className="mt-1">{card.status_ar}</p>
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
        <span>{t('console.card_elapsed', { time: formatCountdown(card.elapsedSec + tick) })}</span>
        {countdown !== null && (
          <span className={countdown <= 10 ? 'font-semibold text-accent' : ''} aria-live="off">
            {t('console.card_countdown', { time: formatCountdown(countdown) })}
          </span>
        )}
        {card.wave > 0 && <span>{t('console.card_wave', { n: card.wave })}</span>}
        {card.pass > 0 && <span>{t('console.card_pass', { n: card.pass })}</span>}
      </p>
      <p className="mt-1 text-xs">
        <Link href={`/map`} className="text-faint hover:text-accent">
          <Mono title={card.tripId}>{shortId(card.tripId)}</Mono>
        </Link>
        {card.customerMayCancelFree && <span className="ms-2 text-faint">· {t('console.card_free_cancel')}</span>}
      </p>

      {card.assignedDriverId && (
        <p className="mt-2 text-xs">
          <span className="text-muted">{t('console.drawer_driver')}: </span>
          <Link href={`/drivers/${encodeURIComponent(card.assignedDriverId)}/ledger`} className="text-accent underline">
            <Mono>{shortId(card.assignedDriverId)}</Mono>
          </Link>
        </p>
      )}

      {openOffers.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">{t('console.card_offers')}</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {openOffers.map((o) => (
              <li key={o.offerId} className="flex justify-between gap-2">
                <Mono>{shortId(o.driverId)}</Mono>
                <span className="text-muted">
                  {offerStateLabel(o.state)} · {t('console.offer_expires', { seconds: Math.max(0, o.expiresInSec - tick) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.suggestion.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">{t('console.card_suggestions')}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {card.suggestion.slice(0, 5).map((d) => (
              <button key={d} type="button" onClick={() => onAssign(d)} className="rounded-pill border border-line bg-surface px-2 py-0.5 text-xs hover:border-accent">
                <Mono>{shortId(d)}</Mono>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.status !== 'assigned' && (
        <button type="button" onClick={() => onAssign()} className={`${red ? primaryBtn : ghostBtn} mt-3 w-full`}>
          {t('console.override_assign')}
        </button>
      )}
      {card.status === 'assigned' && (
        <button type="button" onClick={() => onAssign()} className={`${ghostBtn} mt-3 w-full`}>
          {t('console.reassign')}
        </button>
      )}
    </article>
  );
}

// ───────────────────────── override dialog ─────────────────────────

function OverrideDialog({ target, knownDrivers, onClose }: { target: { card: BoardCard; driverId?: string } | null; knownDrivers: string[]; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = { driver: useId(), reason: useId(), list: useId(), force: useId() };
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const override = useMutation(
    trpc.dispatch.override.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() }) }),
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target) {
      setDriverId(target.driverId ?? target.card.suggestion[0] ?? '');
      setReason('');
      setForce(false);
      override.reset();
      if (!d.open) d.showModal();
    } else if (d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the target changes
  }, [target]);

  const needsReason = force && reason.trim().length === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !driverId.trim() || needsReason) return;
    override.mutate({
      tripId: target.card.tripId,
      driverId: driverId.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(force ? { force: true } : {}),
    });
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="override-title"
      className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-text shadow-card"
    >
      {target && (
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <h2 id="override-title" className="font-display text-lg font-semibold">
              {t('console.override_title')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {verticalLabel(target.card.vertical)} · {zoneName(target.card.zoneId)} · {t('console.override_trip', { trip: shortId(target.card.tripId) })}
            </p>
          </div>

          {target.card.suggestion.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm text-muted">{t('console.override_pick')}</legend>
              <div className="flex flex-wrap gap-1">
                {target.card.suggestion.map((d) => (
                  <button key={d} type="button" aria-pressed={driverId === d} onClick={() => setDriverId(d)} className={ghostBtn}>
                    <Mono>{shortId(d)}</Mono>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor={ids.driver} className="mb-1.5 block text-sm text-muted">
              {t('console.override_driver')}
            </label>
            <input id={ids.driver} dir="ltr" required list={ids.list} className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)} autoComplete="off" />
            <datalist id={ids.list}>
              {knownDrivers.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor={ids.reason} className="mb-1.5 block text-sm text-muted">
              {t('console.override_reason')}
            </label>
            <textarea
              id={ids.reason}
              rows={2}
              maxLength={500}
              className={inputCls}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={needsReason}
              aria-describedby={`${ids.reason}-hint`}
            />
            <p id={`${ids.reason}-hint`} className={`mt-1 text-xs ${needsReason ? 'text-bad' : 'text-faint'}`}>
              {t('console.override_reason_hint')}
            </p>
          </div>

          <label htmlFor={ids.force} className="flex items-start gap-3 text-sm">
            <input id={ids.force} type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={force} onChange={(e) => setForce(e.target.checked)} />
            {t('console.override_force')}
          </label>

          <div role="status" className="min-h-[1.25rem] text-sm">
            {override.isSuccess && (
              <p className="text-ok">
                {t('console.override_sent')}
                {override.data.warnings.length > 0 && <span className="block text-accent">{t('console.override_warnings', { list: override.data.warnings.join('، ') })}</span>}
              </p>
            )}
            {override.error && <p className="text-bad">{override.error.message}</p>}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={() => ref.current?.close()}>
              {override.isSuccess ? t('console.close') : t('console.cancel')}
            </button>
            {!override.isSuccess && (
              <button type="submit" className={primaryBtn} disabled={override.isPending || !driverId.trim() || needsReason}>
                {override.isPending ? t('status.loading') : t('console.override_submit')}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}

// ───────────────────────── alert sound ─────────────────────────

/** Two short beeps when the needs-dispatcher count goes up (opt-in: browsers block autoplay). */
function useAlertSound(enabled: boolean, needs: number) {
  const prev = useRef(needs);
  useEffect(() => {
    const was = prev.current;
    prev.current = needs;
    if (!enabled || needs <= was) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.25].forEach((at) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.2);
      });
      window.setTimeout(() => void ctx.close(), 800);
    } catch {
      /* no audio: the red column is still there */
    }
  }, [enabled, needs]);
}
