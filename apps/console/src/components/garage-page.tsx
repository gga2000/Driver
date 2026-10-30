'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepartureNoShowFee, DriverDepartureView, GarageOpsView, IntercityNetwork, OverdueDeparture, StaffDepartureDriver } from '@driver/contracts';
import { formatRange, t } from '@driver/i18n';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { formatClock, formatIqd } from '@/lib/format';
import { actionFor, isOver, routeLabel, seatDots, sortBoard, stateChip, vehicleLabel, type GarageAction } from '@/lib/garage';
import { queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, EmptyState, Field, IconAlert, IconCheckCircle, Input, LiveBadge, NeedLogin, PageHeader, QueryError, Segmented, Skeleton, useToast } from './ui';

const POLL_MS = 20_000;

/**
 * Console › الرجعة (W3 / NTF-14, Ali 2026-10-08 concept A): one garage's departures today, with the
 * cars that need a person on top: the driver never came (cancel, riders moved to the next cars) or
 * never pressed «وصلت» (arrive on his behalf). Every way out takes a written reason and is logged.
 * No fee for the driver and no credit for riders while M-11 is open.
 */
export function GaragePage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const network = useQuery(trpc.routes.network.queryOptions(undefined, { enabled: signedIn, retry: queryRetry, staleTime: 10 * 60_000 }));
  const garages = useMemo(() => (network.data?.garages ?? []).filter((g) => g.cityId === 'aziziyah').sort((a, b) => Number(a.draft) - Number(b.draft)), [network.data]);
  const [garageId, setGarageId] = useState<string | null>(null);
  const current = garageId ?? garages[0]?.id ?? null;

  if (!signedIn)
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.garage.title')} subtitle={t('console.garage.subtitle')} />
        <NeedLogin />
      </div>
    );
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.garage.title')} subtitle={t('console.garage.subtitle')} />
      {network.error && !network.data ? (
        <QueryError error={network.error} onRetry={() => void network.refetch()} />
      ) : !network.data || !current ? (
        <GarageSkeleton />
      ) : (
        <>
          {garages.length > 1 && (
            <div className="mb-4 overflow-x-auto">
              <Segmented
                label={t('console.garage.pick')}
                value={current}
                onChange={setGarageId}
                options={garages.map((g) => ({ value: g.id, label: g.nameAr }))}
              />
            </div>
          )}
          <GarageLive garageId={current} network={network.data} onGarage={setGarageId} />
        </>
      )}
    </div>
  );
}

function GarageSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-9 w-80 rounded-md" />
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}

interface Acting {
  action: GarageAction;
  dep: Pick<DriverDepartureView, 'id' | 'corridorId' | 'direction' | 'departAt'> | null;
  late: OverdueDeparture | null;
  title: string;
  riders: number;
  driver: string;
}

function GarageLive({ garageId, network, onGarage }: { garageId: string; network: IntercityNetwork; onGarage: (id: string) => void }) {
  const trpc = useTRPC();
  const view = useQuery(trpc.routes.ops.garage.queryOptions({ garageId }, { retry: queryRetry, refetchInterval: POLL_MS }));
  const overdue = useQuery(trpc.routes.ops.overdueDepartures.queryOptions({ limit: 100 }, { retry: queryRetry, refetchInterval: POLL_MS }));
  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const o of overdue.data ?? []) s.add(o.departureId);
    for (const d of view.data?.departures ?? []) s.add(d.id);
    return [...s].slice(0, 100);
  }, [overdue.data, view.data]);
  // Staff names for every run, departed and overdue ones too (one logged vault read per page).
  const cards = useQuery(trpc.routes.ops.departureDrivers.queryOptions({ departureIds: ids }, { enabled: ids.length > 0, retry: queryRetry, staleTime: 60_000 }));
  const [acting, setActing] = useState<Acting | null>(null);

  if (view.error && !view.data) return <QueryError error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) return <GarageSkeleton />;
  return (
    <>
      <GarageBoard
        view={view.data}
        overdue={overdue.data ?? []}
        overdueError={overdue.error && !overdue.data ? overdue.error : null}
        network={network}
        cards={cards.data ?? []}
        updatedAt={view.dataUpdatedAt}
        fetching={view.isFetching}
        onAct={setActing}
        onGarage={onGarage}
      />
      <ActionDialog acting={acting} onClose={() => setActing(null)} />
    </>
  );
}

/** The page body from data (smoke-tested without a server). */
export function GarageBoard({
  view,
  overdue,
  overdueError = null,
  network,
  cards,
  updatedAt,
  fetching = false,
  onAct,
  onGarage,
}: {
  view: GarageOpsView;
  overdue: OverdueDeparture[];
  overdueError?: Parameters<typeof QueryError>[0]['error'] | null;
  network: IntercityNetwork;
  cards: StaffDepartureDriver[];
  updatedAt?: number;
  fetching?: boolean;
  onAct: (a: Acting) => void;
  onGarage: (id: string) => void;
}) {
  const corridors = useMemo(() => new Map(network.corridors.map((c) => [c.id, c])), [network.corridors]);
  const garageName = useMemo(() => new Map(network.garages.map((g) => [g.id, g.nameAr])), [network.garages]);
  const names = useMemo(() => new Map(cards.flatMap((c) => (c.displayName ? [[c.departureId, c.displayName] as const] : []))), [cards]);
  const byId = useMemo(() => new Map(view.departures.map((d) => [d.id, d])), [view.departures]);
  const lateById = useMemo(() => new Map(overdue.map((o) => [o.departureId, o])), [overdue]);
  const board = useMemo(() => sortBoard(view.departures), [view.departures]);
  const live = board.filter((d) => !isOver(d.state));
  const riders = live.reduce((n, d) => n + d.fill.booked + d.fill.walkUpsCounted, 0);
  const driverOf = (depId: string) => names.get(depId) ?? t('console.garage.driver_no_name');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <section aria-label={t('console.garage.needs_person')} data-testid="garage-late">
          <h2 className={cx('mb-2 flex items-center gap-2 text-dense font-semibold', overdue.length ? 'text-bad' : 'text-muted')}>
            {t('console.garage.needs_person')}
            <span className="num">{overdue.length}</span>
            <span className="ms-auto">
              <LiveBadge seconds={POLL_MS / 1000} updatedAt={updatedAt} fetching={fetching} compact />
            </span>
          </h2>
          {overdueError ? (
            <QueryError error={overdueError} />
          ) : overdue.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted shadow-card">
              <IconCheckCircle size={18} className="text-ok" />
              {t('console.garage.none_late')}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-lg border border-bad/40 bg-bad-tint/40">
              {overdue.map((o, i) => {
                const dep = byId.get(o.departureId);
                const route = routeLabel(corridors.get(o.corridorId), dep?.direction ?? 'from_aziziyah');
                const elsewhere = o.garageId !== view.garage.id;
                const action = actionFor(o.state, o);
                const title = dep ? t('console.garage.run_title', { route, time: formatClock(dep.departAt) }) : route;
                return (
                  <li key={o.departureId} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5', i > 0 && 'border-t border-bad/25')} data-testid={`late-${o.departureId}`}>
                    <Chip tone={o.reason === 'driver_no_show' ? 'bad' : 'warn'} dot>
                      {t(o.reason === 'driver_no_show' ? 'console.garage.late_no_show' : 'console.garage.late_not_arrived')}
                    </Chip>
                    <div className="min-w-[min(100%,16rem)] flex-1">
                      <p className="text-sm font-semibold">
                        <span className="num">{title}</span>
                        <span className="font-normal text-muted">
                          {' · '}
                          {driverOf(o.departureId)}
                          {dep && vehicleLabel(dep.vehicle) ? ` · ${vehicleLabel(dep.vehicle)}` : ''}
                        </span>
                      </p>
                      <p className="num text-dense text-muted">
                        {o.reason === 'driver_no_show'
                          ? t('console.garage.no_show_line', { n: o.riders, latest: dep ? formatClock(dep.latestDepartureAt) : '—' })
                          : t('console.garage.not_arrived_line', { n: o.riders, left: dep?.departedAt ? formatClock(dep.departedAt) : '—' })}
                        {o.noShowFee && o.noShowFee.driverChargeIqd > 0 ? ` · ${t('console.garage.fee_line', { amount: formatIqd(o.noShowFee.driverChargeIqd) })}` : ''}
                        {elsewhere ? (
                          <>
                            {' · '}
                            <button type="button" className="font-medium text-accent-text underline-offset-4 hover:underline" onClick={() => onGarage(o.garageId)}>
                              {garageName.get(o.garageId) ?? o.garageId}
                            </button>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className={cx('num shrink-0 rounded-md px-2 text-xs font-bold', o.reason === 'driver_no_show' ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn')}>
                      {t('console.garage.late_min', { n: o.minutes })}
                    </span>
                    {action && (
                      <Button
                        size="sm"
                        variant={action === 'cancel' ? 'danger' : 'primary'}
                        data-testid={`act-${o.departureId}`}
                        onClick={() =>
                          onAct({ action, dep: dep ?? null, late: o, title, riders: o.riders, driver: driverOf(o.departureId) })
                        }
                      >
                        {t(action === 'cancel' ? 'console.garage.do_cancel' : 'console.garage.do_arrive')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card
          title={t('console.garage.board_title', { garage: view.garage.nameAr })}
          hint={t('console.garage.board_hint', { cars: live.length, riders })}
          flush
        >
          {board.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState bare title={t('console.garage.empty')} hint={t('console.garage.empty_hint')} />
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
                <caption className="sr-only">{t('console.garage.board_title', { garage: view.garage.nameAr })}</caption>
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="border-b border-line px-5 py-2 text-start font-medium">{t('console.garage.col_time')}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-start font-medium">{t('console.garage.col_route')}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-start font-medium">{t('console.garage.col_driver')}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-start font-medium">{t('console.garage.col_seats')}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-start font-medium">{t('console.garage.col_state')}</th>
                    <th scope="col" className="border-b border-line px-5 py-2"><span className="sr-only">{t('console.garage.col_action')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((d) => {
                    const late = lateById.get(d.id);
                    const chip = stateChip(d.state, late);
                    const over = isOver(d.state);
                    const action = actionFor(d.state, late);
                    const route = routeLabel(corridors.get(d.corridorId), d.direction);
                    const title = t('console.garage.run_title', { route, time: formatClock(d.departAt) });
                    return (
                      <tr key={d.id} className={cx(over && 'text-muted', late && 'bg-bad-tint/30')} data-testid={`run-${d.id}`}>
                        <td className="num border-b border-line/70 px-5 py-2.5 text-base font-bold">{formatClock(d.departAt)}</td>
                        <td className="border-b border-line/70 px-3 py-2.5">
                          {route}
                          {d.familyOnly ? <span className="text-xs text-muted"> · {t('console.garage.family_only')}</span> : null}
                        </td>
                        <td className="border-b border-line/70 px-3 py-2.5">
                          <span className="block">{driverOf(d.id)}</span>
                          <span className="num block text-xs text-muted">{[vehicleLabel(d.vehicle), d.vehicle.plate].filter(Boolean).join(' · ')}</span>
                        </td>
                        <td className="border-b border-line/70 px-3 py-2.5">
                          <Seats d={d} />
                        </td>
                        <td className="border-b border-line/70 px-3 py-2.5">
                          <Chip tone={chip.tone} dot={!over} size="sm">
                            {t(chip.key)}
                            {late ? <span className="num"> · {t('console.garage.late_min', { n: late.minutes })}</span> : null}
                          </Chip>
                        </td>
                        <td className="border-b border-line/70 px-5 py-2.5 text-end">
                          {action === 'close' ? (
                            <Button size="sm" variant="secondary" onClick={() => onAct({ action, dep: d, late: null, title, riders: d.fill.booked, driver: driverOf(d.id) })}>
                              {t('console.garage.do_close')}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <aside className="space-y-4" aria-label={t('console.garage.side')}>
        <Card title={t('console.garage.stranded', { n: view.stranded.length })} hint={t('console.garage.stranded_hint')}>
          {view.stranded.length === 0 ? (
            <p className="text-sm text-muted">{t('console.garage.stranded_none')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {view.stranded.map((s) => {
                const dep = byId.get(s.departureId);
                return (
                  <li key={s.bookingId} className="num flex justify-between gap-2">
                    <span>{dep ? routeLabel(corridors.get(dep.corridorId), dep.direction) : t('console.garage.rider')}</span>
                    <span className="text-muted">{formatClock(s.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title={t('console.garage.demand')} hint={t('console.garage.demand_hint')}>
          {view.demand.filter((b) => b.postedSeats > 0).length === 0 ? (
            <p className="text-sm text-muted">{t('console.garage.demand_none')}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {view.demand
                .filter((b) => b.postedSeats > 0)
                .map((b) => (
                  <li key={`${b.garageId ?? 'any'}-${b.windowStart.getTime()}`}>
                    <p className="num">
                      {t('console.garage.demand_row', { range: formatRange(formatClock(b.windowStart), formatClock(b.windowEnd), undefined, { spaced: true }), asked: b.postedSeats, taken: b.claimedSeats })}
                    </p>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-3">
                      <span className="block h-full rounded-pill bg-accent" style={{ width: `${Math.min(100, Math.round((b.claimedSeats / b.postedSeats) * 100))}%` }} />
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

function Seats({ d }: { d: DriverDepartureView }) {
  const dots = seatDots(d);
  const taken = d.fill.booked + d.fill.walkUpsCounted;
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-[3px]" aria-hidden>
        {dots.map((s, i) => (
          <span
            key={i}
            className={cx(
              'block h-[18px] w-3.5 rounded-[4px]',
              s === 'booked' && 'bg-accent',
              s === 'walkup' && 'bg-warn-solid/70',
              s === 'held' && 'bg-accent/40',
              s === 'free' && 'bg-surface-3',
            )}
          />
        ))}
      </span>
      <span className="num text-xs text-muted">{t('console.garage.seats_of', { n: taken, total: d.fill.seatsTotal })}</span>
    </span>
  );
}

const EXPLAIN = {
  cancel: ['console.garage.cancel_1', 'console.garage.cancel_2', 'console.garage.cancel_3'],
  arrive: ['console.garage.arrive_1', 'console.garage.arrive_2'],
  close: ['console.garage.close_1'],
} as const;

function ActionDialog({ acting, onClose }: { acting: Acting | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const done = {
    onSuccess: (r: { changed: boolean; noShowFee?: DepartureNoShowFee | null }) => {
      void qc.invalidateQueries({ queryKey: trpc.routes.ops.garage.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.routes.ops.overdueDepartures.queryKey() });
      // M-11: say what the cancel actually charged (null with the switch off or on a replay).
      const fee = r.noShowFee;
      toast({
        title: t(r.changed ? 'console.garage.done' : 'console.garage.already'),
        body: fee && fee.driverChargeIqd > 0 ? t('console.garage.fee_done', { n: fee.riders, per: formatIqd(fee.perRiderIqd), amount: formatIqd(fee.driverChargeIqd) }) : undefined,
        tone: 'ok',
      });
      onClose();
    },
  };
  const cancel = useMutation(trpc.routes.ops.cancelDeparture.mutationOptions(done));
  const arrive = useMutation(trpc.routes.ops.arriveDeparture.mutationOptions(done));
  const close = useMutation(trpc.routes.ops.closeDeparture.mutationOptions(done));
  const m = acting?.action === 'cancel' ? cancel : acting?.action === 'arrive' ? arrive : close;
  useEffect(() => {
    if (!acting) return;
    setReason('');
    cancel.reset();
    arrive.reset();
    close.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new action only
  }, [acting]);
  const valid = reason.trim().length >= 3;
  const id = acting?.dep?.id ?? acting?.late?.departureId ?? '';
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!acting || !valid || !id) return;
    m.mutate({ departureId: id, reason: reason.trim() });
  };
  const verb = acting ? t(acting.action === 'cancel' ? 'console.garage.do_cancel' : acting.action === 'arrive' ? 'console.garage.do_arrive' : 'console.garage.do_close') : '';
  return (
    <Dialog
      open={acting !== null}
      onClose={onClose}
      labelledBy="garage-act-title"
      width="sm"
      title={acting ? t('console.garage.dialog_title', { verb, run: acting.title }) : ''}
      description={acting ? t('console.garage.dialog_who', { driver: acting.driver, n: acting.riders }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant={acting?.action === 'cancel' ? 'danger' : 'primary'} needsNet disabled={!valid} loading={m.isPending} onClick={() => submit()} data-testid="garage-confirm">
            {verb}
          </Button>
        </>
      }
    >
      {acting && (
        <form onSubmit={submit} className="space-y-4 pb-1">
          <ul className="list-disc space-y-1.5 ps-5 text-sm">
            {EXPLAIN[acting.action].map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
          {acting.action === 'cancel' && acting.late?.reason === 'driver_no_show' ? <NoShowFeeNote fee={acting.late.noShowFee ?? null} /> : null}
          <Field label={t('console.ctl_reason')} htmlFor={reasonId} hint={t('console.garage.reason_hint')}>
            <Input
              id={reasonId}
              required
              minLength={3}
              maxLength={500}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(acting.action === 'cancel' ? 'console.garage.reason_cancel_ph' : acting.action === 'arrive' ? 'console.garage.reason_arrive_ph' : 'console.garage.reason_close_ph')}
            />
          </Field>
          <div role="status" className="min-h-[1.25rem] text-sm">
            {m.error && <p className="text-bad">{errorText(m.error)}</p>}
          </div>
        </form>
      )}
    </Dialog>
  );
}

/**
 * M-11 (Ali, 2026-10-09): cancelling a run whose driver never came credits each booked rider and
 * charges the driver the total, behind GARAGE_NO_SHOW_FEE. Amounts come from the server only.
 */
function NoShowFeeNote({ fee }: { fee: DepartureNoShowFee | null }) {
  if (!fee || fee.riders === 0) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-dense text-muted" data-testid="garage-fee">
        <IconAlert size={16} className="mt-0.5 shrink-0" />
        <span>{t(fee ? 'console.garage.fee_no_riders' : 'console.garage.fee_off')}</span>
      </p>
    );
  }
  return (
    <div className="rounded-md border border-warn-solid/40 bg-warn-tint px-3 py-2.5 text-dense" data-testid="garage-fee">
      <p className="flex items-start gap-2 font-semibold text-text">
        <IconAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <span className="num">{t('console.garage.fee_charge', { amount: formatIqd(fee.driverChargeIqd) })}</span>
      </p>
      <p className="num mt-1 ps-6 text-text">
        {t('console.garage.fee_riders', { n: fee.riders, per: formatIqd(fee.perRiderIqd) })}
        {fee.doubled ? ` ${t('console.garage.fee_doubled')}` : ''}
      </p>
      <p className="mt-1 ps-6 text-xs text-muted">{t('console.garage.fee_settle')}</p>
    </div>
  );
}
