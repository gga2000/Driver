'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FinanceDeskView, RoundStop } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { arabicDay } from '@/lib/control-room';
import { formatClock, formatIqd, formatMoney } from '@/lib/format';
import { hasAny, useMyRoles } from '@/lib/me';
import { codeValid, collectAmountProblem, courierRoundState, normalizeCode, parseAmount, printRows, receiptKey, roundProgress, stopDone } from '@/lib/round';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { RoundMap } from './round-map';
import { Button, Card, cx, Dialog, EmptyState, Field, IconCheck, IconCheckCircle, IconPrinter, Input, useToast } from './ui';

type RoundCourier = RoundStop['couriers'][number];

/** Who records a receipt: field ops on the round (and admin), as `ops.recordCashReceipt` allows. */
const COLLECT_ROLES = ['field_ops', 'admin'] as const;

/**
 * S-K5 · the 23:00 round in round mode. The best screen of the Console, now worked from: a live
 * "جمعنا 612,000 من 746,710 دينار" line, each courier on his stop with "استلمت" (the cash counted in
 * front of him, confirmed with the 4-digit code his app shows — `ops.recordCashReceipt`, the same
 * receipt field ops record in the Partner app), and the route printed for the field-ops phone.
 * The map stays as it was (round-map.tsx, the maps session's).
 */
export function CollectionRound({ desk }: { desk: FinanceDeskView }) {
  const r = desk.round;
  const p = roundProgress(r);
  const { roles } = useMyRoles();
  const canCollect = hasAny(roles, COLLECT_ROLES);
  const [collecting, setCollecting] = useState<RoundCourier | null>(null);
  const couriers = r.stops.reduce((n, s) => n + s.couriers.length, 0);
  const print = () => {
    document.documentElement.dataset['printing'] = 'round';
    const done = () => {
      delete document.documentElement.dataset['printing'];
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  return (
    <section data-testid="cash-round">
      <Card
        title={t('console.fin_round', { time: formatClock(r.at) })}
        hint={r.stops.length ? t('console.fin_round_summary', { amount: formatMoney(r.totalIqd), n: couriers, stops: t('console.fin_round_stops', { n: r.stops.length }) }) : undefined}
        actions={
          r.stops.length ? (
            <Button icon={<IconPrinter size={16} />} onClick={print} data-testid="round-print">
              {t('console.fin_round_print')}
            </Button>
          ) : undefined
        }
        flush
      >
        {r.stops.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={<IconCheckCircle size={20} />} title={t('console.fin_round_empty')} hint={t('console.fin_round_empty_hint')} />
          </div>
        ) : (
          <>
            <RoundProgressBar progress={p} />
            <div className="grid border-t border-line lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <ol className="relative max-h-[38rem] overflow-y-auto px-5 py-4" aria-label={t('console.fin_round_list')}>
                {r.stops.map((s, i) => (
                  <StopRow key={s.zoneKey} stop={s} last={i === r.stops.length - 1} canCollect={canCollect} onCollect={setCollecting} />
                ))}
              </ol>
              <div className="border-t border-line p-4 lg:border-s lg:border-t-0">
                <RoundMap stops={r.stops} className="aspect-[4/3] w-full overflow-hidden rounded-md border border-line" />
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-text" /> {t('console.fin_round_base')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-pill bg-accent" /> {t('console.fin_legend_stop')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-pill bg-bad-solid" /> {t('console.fin_legend_over')}
                  </span>
                </p>
                {!canCollect ? <p className="mt-3 text-xs text-muted">{t('console.fin_collect_no_role')}</p> : null}
              </div>
            </div>
          </>
        )}
      </Card>
      {/* The dialog follows the desk as it refreshes: what he holds can change while it is open (he
          hands a restaurant its cash, pays at an agent). Gone from the round means he holds nothing. */}
      <CollectDialog courier={collecting ? (r.stops.flatMap((st) => st.couriers).find((c) => c.driverId === collecting.driverId) ?? { ...collecting, heldIqd: 0 }) : null} onClose={() => setCollecting(null)} />
      <RoundPrint desk={desk} />
    </section>
  );
}

function RoundProgressBar({ progress: p }: { progress: ReturnType<typeof roundProgress> }) {
  return (
    <div className="border-t border-line px-5 py-4" data-testid="round-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="num text-[22px] font-bold leading-8 tracking-[-0.01em]" aria-live="polite">
          {p.done ? t('console.fin_round_progress_done', { amount: formatIqd(p.collectedIqd) }) : t('console.fin_round_progress', { collected: formatIqd(p.collectedIqd), target: formatIqd(p.targetIqd) })}
        </p>
        {!p.done ? <p className="num text-sm text-muted">{t('console.fin_round_progress_left', { amount: formatIqd(p.leftIqd), n: p.couriersLeft })}</p> : null}
      </div>
      <span role="progressbar" aria-label={t('console.fin_round_progress_aria')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} className="relative mt-3 block h-2.5 overflow-hidden rounded-pill bg-surface-3">
        <span className="absolute inset-y-0 start-0 rounded-pill bg-ok-solid transition-[width] duration-base ease-standard motion-reduce:transition-none" style={{ width: `${p.pct}%` }} />
      </span>
    </div>
  );
}

function StopRow({ stop: s, last, canCollect, onCollect }: { stop: RoundStop; last: boolean; canCollect: boolean; onCollect: (c: RoundCourier) => void }) {
  const done = stopDone(s);
  const over = s.couriers.filter((c) => c.overCap && c.heldIqd > 0).length;
  return (
    <li className="relative flex gap-4 pb-5 last:pb-0" data-testid={`round-stop-${s.seq}`}>
      {!last && <span aria-hidden className="absolute start-[13px] top-8 h-[calc(100%-28px)] w-0.5 rounded-pill bg-line" />}
      <span className={cx('num relative mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-dense font-bold', done ? 'bg-ok-tint text-ok' : over ? 'bg-bad-solid text-on-bad' : 'bg-accent text-on-accent')}>
        {done ? <IconCheck size={15} /> : s.seq}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[15px] font-semibold">{s.zone_ar}</span>
          <span className={cx('num text-sm font-semibold', done && 'text-ok')}>{done ? t('console.fin_collected_short') : formatMoney(s.totalIqd)}</span>
        </p>
        <ul className="mt-2 divide-y divide-line rounded-md border border-line">
          {s.couriers.map((c) => (
            <CourierRow key={c.driverId} c={c} canCollect={canCollect} onCollect={() => onCollect(c)} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function CourierRow({ c, canCollect, onCollect }: { c: RoundCourier; canCollect: boolean; onCollect: () => void }) {
  const state = courierRoundState(c);
  const name = c.name ?? <PersonName id={c.driverId} copy={false} />;
  return (
    <li className={cx('flex min-h-[52px] items-center gap-3 px-3 py-2', state === 'collected' && 'bg-ok-tint/50')} data-testid={`round-courier-${c.driverId}`}>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm font-semibold', c.overCap && state !== 'collected' && 'text-bad')}>
          {name}
          {c.overCap && state !== 'collected' ? <span className="font-medium"> · {t('console.fin_over_cap_short')}</span> : null}
        </span>
        <span className="num block text-xs text-muted">
          {state === 'holding'
            ? formatMoney(c.heldIqd)
            : state === 'partial'
              ? `${t('console.fin_collected', { amount: formatIqd(c.collected!.amountIqd), time: formatClock(c.collected!.at) })} · ${t('console.fin_still_holds', { amount: formatIqd(c.heldIqd) })}`
              : t('console.fin_collected', { amount: formatIqd(c.collected!.amountIqd), time: formatClock(c.collected!.at) })}
        </span>
      </span>
      {state === 'collected' ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-ok-tint px-3 text-dense font-semibold text-ok">
          <IconCheckCircle size={16} /> {t('console.fin_collected_short')}
        </span>
      ) : (
        <Button
          size="sm"
          variant={canCollect ? 'primary' : 'secondary'}
          disabled={!canCollect}
          title={canCollect ? undefined : t('console.fin_collect_no_role')}
          aria-label={t('console.fin_collect_a11y', { name: c.name ?? '' })}
          onClick={onCollect}
          data-testid={`collect-${c.driverId}`}
          className="min-h-[36px] px-4"
        >
          {t('console.fin_collect')}
        </Button>
      )}
    </li>
  );
}

/** "استلمت": the amount (defaults to what he holds) and the code he reads from his app. */
function CollectDialog({ courier, onClose }: { courier: RoundCourier | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const amountId = useId();
  const codeId = useId();
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const driverId = courier?.driverId ?? null;
  const held = courier?.heldIqd ?? 0;
  const heldRef = useRef(held);
  heldRef.current = held;
  // A fresh form per courier opened — not on every desk refresh, which would wipe what was typed.
  useEffect(() => {
    if (!driverId) return;
    setAmount(formatIqd(heldRef.current));
    setCode('');
    setKey(receiptKey(driverId, Date.now()));
  }, [driverId]);
  const record = useMutation(
    trpc.ops.recordCashReceipt.mutationOptions({
      onSuccess: (r) => {
        toast({ title: t('console.fin_collect_done', { amount: formatIqd(r.amountIqd), name: courier?.name ?? '' }), body: r.reference, tone: 'ok' });
        void qc.invalidateQueries(trpc.finance.desk.pathFilter());
        onClose();
      },
      onError: (e) => {
        // He handed some cash on (or the desk was a poll behind) since the dialog opened: refresh what
        // he holds, so the field shows "أكثر من اللي بيده" against today's number.
        if (e.data?.code === 'cash_receipt_exceeds_held') void qc.invalidateQueries(trpc.finance.desk.pathFilter());
        toast({ title: t('console.fin_collect_failed'), body: e.message, tone: 'bad' });
      },
    }),
  );
  const value = parseAmount(amount);
  const problem = collectAmountProblem(value, held);
  const ready = problem === null && codeValid(code);
  const submit = () => {
    if (!courier || !ready || record.isPending) return;
    record.mutate({ courierId: courier.driverId, amountIqd: value, code, idempotencyKey: key });
  };
  return (
    <Dialog
      open={courier !== null}
      onClose={onClose}
      width="sm"
      labelledBy="collect-title"
      title={t('console.fin_collect_title', { name: courier?.name ?? '' })}
      description={t('console.fin_collect_desc')}
      footer={
        <Button variant="primary" size="lg" disabled={!ready} loading={record.isPending} onClick={submit} data-testid="collect-confirm">
          {t('console.fin_collect_confirm', { amount: formatIqd(value) })}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('console.fin_collect_amount')} htmlFor={amountId} hint={t('console.fin_collect_amount_hint', { amount: formatIqd(held) })} error={problem === 'too_much' ? t('console.fin_collect_too_much') : undefined}>
          <Input id={amountId} inputMode="numeric" dir="ltr" className="num text-end text-base" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={problem === 'too_much'} />
        </Field>
        <Field label={t('console.fin_collect_code')} htmlFor={codeId} hint={t('console.fin_collect_code_hint')}>
          <Input
            id={codeId}
            data-testid="collect-code"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            maxLength={4}
            className="num h-12 text-center text-2xl font-bold tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
        </Field>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/**
 * The printed route (print stylesheet: only this shows when "اطبع الطريق" prints): stops in order,
 * each courier with what he holds and boxes for his code and the tick — one A4 or a PDF on the phone.
 */
function RoundPrint({ desk }: { desk: FinanceDeskView }) {
  const rows = printRows(desk.round);
  return (
    <div data-print-root className="hidden print:block" dir="rtl">
      <h1 className="text-xl font-bold">{t('console.fin_round_print_title', { day: arabicDay(desk.localDate), time: formatClock(desk.round.at) })}</h1>
      <p className="mt-1 text-sm">{t('console.fin_round_print_hint')}</p>
      <p className="num mt-1 text-sm font-semibold">{t('console.fin_round_print_total', { amount: formatIqd(desk.round.totalIqd) })}</p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr>
            {(['stop', 'courier', 'amount', 'code', 'done'] as const).map((k) => (
              <th key={k} className="border-b-2 border-black px-2 py-1.5 text-start font-bold">
                {t(`console.fin_round_print_col_${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driverId} className={cx('break-inside-avoid', r.firstOfStop && 'border-t border-black')}>
              <td className="px-2 py-2 align-top font-semibold">{r.firstOfStop ? `${r.seq} · ${r.zone}` : ''}</td>
              <td className="px-2 py-2">
                {r.name ?? r.driverId}
                {r.overCap && !r.collected ? ` · ${t('console.fin_over_cap_short')}` : ''}
              </td>
              <td className="num px-2 py-2">{r.collected ? t('console.fin_collected_short') : formatIqd(r.heldIqd)}</td>
              <td className="px-2 py-2">
                <span className="inline-block h-6 w-20 border border-black" />
              </td>
              <td className="px-2 py-2">
                <span className="inline-block h-6 w-6 border border-black" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
