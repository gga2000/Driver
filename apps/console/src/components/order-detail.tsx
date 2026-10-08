'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { ChatThreadKind, type ChatThreadKind as ChatKind, type Order, type TicketChannel, type TicketKind } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { formatClock, formatIqd } from '@/lib/format';
import { orderTypeLabel, participantRoleLabel, paymentLabel, priceLabel, vehicleLabel, zoneName } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { orderLabel, useNames } from '@/lib/names';
import { errorText } from '@/lib/network';
import {
  ACTIVE_STATES,
  dispatchSummary,
  eventTimeline,
  groupLinesByParticipant,
  lineTotal,
  moneyLines,
  orderStory,
  priceCheck,
  priceRows,
  storyTotalMin,
  type LogEntry,
  type StoryStep,
} from '@/lib/orders';
import { stamp } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import { compactDuration } from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import { CopyId, ItemName, OrgName, PersonName } from './named';
import { OrderReplay } from './order-replay';
import { OrderStatus } from './order-status';
import { ChatVoiceNote } from './support/voice-note';
import {
  Avatar,
  Button,
  buttonCls,
  Card,
  Chip,
  cx,
  Dialog,
  EmptyState,
  Field,
  httpStatusOf,
  IconBack,
  IconChat,
  IconCheck,
  IconClock,
  IconDispatch,
  IconLock,
  IconSupport,
  Input,
  Mono,
  NeedLogin,
  QueryError,
  Row,
  Segmented,
  Select,
  Skeleton,
  Tabs,
  Timeline,
  useNow,
  useToast,
} from './ui';

const POLL_MS = 5_000;
const RIDE_TYPES: ReadonlySet<string> = new Set(['ride', 'seat', 'subscription']);

/**
 * One order: the header (#1284, status, who), the story in four moments with "كل الأحداث" behind it,
 * then the order and its money in words (or its chats, read only) beside the people on it. Actions
 * sit in one calm group: open a ticket, compensate (through a ticket), change the courier (on Dispatch).
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const now = new Date(useNow(15_000));
  const order = useQuery(trpc.orders.get.queryOptions({ orderId }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS }));
  const log = useQuery(trpc.orders.events.queryOptions({ orderId }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS }));
  // The summary row carries the late minutes (the orders module's rule), one light read.
  const summary = useQuery(trpc.orders.search.queryOptions({ cityId: CITY_ID, text: orderId, limit: 1 }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS * 3 }));
  const o = order.data;
  const tripIds = useMemo(() => [...new Set((log.data ?? []).map((e) => e.tripId).filter((x): x is string => Boolean(x)))], [log.data]);
  const tripLogs = useQueries({ queries: tripIds.map((tripId) => trpc.trips.events.queryOptions({ tripId }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS })) });
  const lastTrip = useQuery(trpc.trips.get.queryOptions({ tripId: tripIds.at(-1) ?? '' }, { enabled: signedIn && tripIds.length > 0, retry: false, refetchInterval: POLL_MS * 2 }));
  const events = useMemo(() => eventTimeline(log.data ?? [], ...tripLogs.map((q) => q.data ?? [])), [log.data, tripLogs]);
  const courierId = lastTrip.data?.courierId ?? null;
  const row = summary.data?.rows.find((r) => r.id === orderId);
  const lateMin = row?.lateMin ?? null;
  const atRisk = useQuery(trpc.orders.atRisk.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry, refetchInterval: 30_000 }));
  const risk = atRisk.data?.find((r) => r.orderId === orderId) ?? null;

  if (!signedIn)
    return (
      <Frame>
        <NeedLogin />
      </Frame>
    );
  if (order.error)
    return (
      <Frame>
        {httpStatusOf(order.error) === 404 ? (
          <EmptyState title={t('console.order_not_found')} hint={t('console.order_not_found_hint')}>
            <Link href="/orders" className={buttonCls('secondary', 'sm')}>
              {t('console.order_back')}
            </Link>
          </EmptyState>
        ) : (
          <QueryError error={order.error} onRetry={() => void order.refetch()} />
        )}
      </Frame>
    );
  if (!o)
    return (
      <Frame>
        <div className="space-y-5" aria-busy>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-56 rounded-lg" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Skeleton className="h-80 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        </div>
      </Frame>
    );

  const details = detailRows(o, now);
  const aside = details.length > 0 || o.partial !== null;
  return (
    <Frame>
      <Header o={o} lateMin={lateMin} riskMin={risk?.lateByMin ?? null} courierId={courierId} now={now} />
      <section aria-labelledby="order-story" className="rounded-lg border border-line bg-surface shadow-card">
        <Facts o={o} courierId={courierId} zoneKey={row?.zoneKey ?? null} />
        <Story o={o} events={events} now={now} logError={log.error} />
      </section>
      <OrderReplay orderId={o.id} />
      <div className={cx('mt-5 grid items-start gap-5', aside && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
        <MainPanel o={o} />
        {aside ? <DetailsCard o={o} rows={details} /> : null}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1240px]">
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 rounded-md text-dense text-muted hover:text-accent-text">
        <IconBack size={16} />
        {t('console.order_back')}
      </Link>
      {children}
    </div>
  );
}

// ───────────────────────── header + actions ─────────────────────────

function Header({ o, lateMin, riskMin, courierId, now }: { o: Order; lateMin: number | null; riskMin: number | null; courierId: string | null; now: Date }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xl font-bold tracking-[-0.01em]">
          <bdi className="num" title={o.id}>
            {orderLabel(o.id)}
          </bdi>
          <CopyId id={o.id} />
          <OrderStatus state={o.state} />
          {lateMin !== null && (
            <Chip tone="bad">
              <IconClock size={13} />
              {t('console.orders_late_by', { time: compactDuration(lateMin * 60_000) })}
            </Chip>
          )}
          {/* Maps program o4: not late yet, but his live ETA lands past the promise. */}
          {lateMin === null && riskMin !== null && (
            <Chip tone="warn" data-testid="order-at-risk">
              <IconClock size={13} />
              {t('console.orders_at_risk_by', { time: compactDuration(riskMin * 60_000) })}
            </Chip>
          )}
        </h1>
        <p className="num mt-1 text-sm text-muted">
          {orderTypeLabel(o.type)}
          <span aria-hidden className="mx-1.5 text-faint">
            ·
          </span>
          {t('console.order_placed_at', { time: stamp(o.placedAt, now) })}
        </p>
      </div>
      <Actions o={o} courierId={courierId} />
    </header>
  );
}

type ActionKind = 'contact' | 'ticket' | 'reassign';

function Actions({ o, courierId }: { o: Order; courierId: string | null }) {
  const trpc = useTRPC();
  const { roles } = useMyRoles();
  const [open, setOpen] = useState<ActionKind | null>(null);
  const support = hasAny(roles, ['support', 'dispatcher', 'finance', 'admin']);
  const dispatch = hasAny(roles, ['dispatcher', 'admin']);
  // A ticket already open on this order: the actions lead there instead of opening a second one.
  const tickets = useQuery(trpc.support.list.queryOptions({ cityId: CITY_ID, status: 'active', limit: 200 }, { enabled: support, retry: false, refetchInterval: 30_000 }));
  const existing = tickets.data?.rows.find((r) => r.orderId === o.id) ?? null;
  const active = ACTIVE_STATES.includes(o.state);
  const ride = RIDE_TYPES.has(o.type);
  if (!support && !dispatch) return null;
  return (
    <div role="group" aria-label={t('console.order_actions')} className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {support && existing ? (
          <Link href={`/support/${encodeURIComponent(existing.id)}`} className={buttonCls('secondary', 'sm')}>
            <IconSupport size={16} />
            {t('console.order_ticket_go')}
          </Link>
        ) : support ? (
          <>
            <Button size="sm" icon={<IconChat size={16} />} onClick={() => setOpen('contact')}>
              {t('console.order_contact')}
            </Button>
            <Button size="sm" icon={<IconSupport size={16} />} onClick={() => setOpen('ticket')}>
              {t('console.order_open_ticket')}
            </Button>
          </>
        ) : null}
        {dispatch && active && !ride ? (
          <Button size="sm" icon={<IconDispatch size={16} />} onClick={() => setOpen('reassign')}>
            {courierId ? t('console.order_reassign') : t('console.order_assign')}
          </Button>
        ) : null}
      </div>
      {existing ? (
        <p className="max-w-[26rem] truncate text-xs text-muted" title={existing.subject}>
          {t('console.order_ticket_existing', { subject: existing.subject })}
        </p>
      ) : null}
      {open === 'contact' || open === 'ticket' ? <TicketDialog o={o} contact={open === 'contact'} onClose={() => setOpen(null)} /> : null}
      <Dialog
        open={open === 'reassign'}
        onClose={() => setOpen(null)}
        width="sm"
        title={t(courierId ? 'console.order_reassign_title' : 'console.order_assign_title', { order: orderLabel(o.id) })}
        description={t('console.order_reassign_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t('console.cancel')}
            </Button>
            <Link href="/dispatch" className={buttonCls('primary')}>
              {t('console.order_reassign_go')}
            </Link>
          </>
        }
      >
        <p className="pb-2 text-sm text-muted">{t('console.order_reassign_more')}</p>
      </Dialog>
    </div>
  );
}

/**
 * Opens a support ticket on the order and goes to it. "راسل الزبون" starts one on WhatsApp (the reply
 * is written on the desk, where it is logged); "افتح تذكرة" also asks for the kind.
 */
function TicketDialog({ o, contact, onClose }: { o: Order; contact: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();
  const ids = { subject: useId(), kind: useId() };
  const label = orderLabel(o.id);
  const [subject, setSubject] = useState(t(contact ? 'console.order_contact_subject_default' : 'console.order_ticket_subject_default', { order: label }).replace(/[⁦-⁩]/g, ''));
  const [kind, setKind] = useState<TicketKind>(o.state === 'disputed' ? 'dispute' : contact ? 'question' : 'complaint');
  const [channel, setChannel] = useState<Exclude<TicketChannel, 'chat'>>(contact ? 'whatsapp' : 'phone');
  const open = useMutation(
    trpc.support.open.mutationOptions({
      onSuccess: (ticket) => {
        toast({ title: t('console.order_ticket_opened'), tone: 'ok' });
        router.push(`/support/${encodeURIComponent(ticket.id)}`);
      },
    }),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t(contact ? 'console.order_contact_title' : 'console.order_ticket_title', { order: label })}
      description={t(contact ? 'console.order_contact_body' : 'console.order_ticket_body', { order: label })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={open.isPending}
            disabled={subject.trim().length < 3}
            onClick={() => open.mutate({ cityId: CITY_ID, kind, channel, subject: subject.trim(), orderId: o.id, customerId: o.ordererId })}
          >
            {t(contact ? 'console.order_contact_go' : 'console.order_ticket_open')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="space-y-1.5">
          <p className="text-dense font-medium text-text">{t('console.order_ticket_channel')}</p>
          <Segmented
            label={t('console.order_ticket_channel')}
            value={channel}
            onChange={setChannel}
            options={(['whatsapp', 'phone'] as const).map((c) => ({ value: c, label: t(`console.sup_channel_${c}` as MessageKey) }))}
          />
        </div>
        <Field label={t('console.order_ticket_subject')} htmlFor={ids.subject} error={subject.trim().length < 3 ? t('console.order_ticket_subject_short') : undefined}>
          <Input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={subject.trim().length < 3 || undefined} />
        </Field>
        {!contact ? (
          <Field label={t('console.order_ticket_kind')} htmlFor={ids.kind}>
            <Select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as TicketKind)}>
              {(['complaint', 'dispute', 'question', 'incident'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`console.sup_kind_${k}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {open.error ? (
          <p role="alert" className="text-sm text-bad">
            {errorText(open.error)}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ───────────────────────── who and how much ─────────────────────────

/**
 * The facts people ask first, in one row: the restaurant, the customer (first name and area), the
 * courier (name, vehicle, plate, his book), how it is paid and the total.
 */
function Facts({ o, courierId, zoneKey }: { o: Order; courierId: string | null; zoneKey: string | null }) {
  const names = useNames({ people: [o.ordererId, ...(courierId ? [courierId] : [])], orgs: o.merchantOrgId ? [o.merchantOrgId] : [] });
  const ride = RIDE_TYPES.has(o.type);
  const courier = courierId ? names.person(courierId) : null;
  const vehicle = [courier?.vehicleClass ? vehicleLabel(courier.vehicleClass) : null, courier?.plate].filter(Boolean).join(' · ');
  return (
    <dl className="grid grid-cols-2 border-b border-line md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto]">
      <Fact label={t('console.order_merchant')}>
        {o.merchantOrgId ? <OrgName id={o.merchantOrgId} copy={false} className="font-semibold" /> : <span className="text-muted">{t('console.order_no_merchant')}</span>}
      </Fact>
      <Fact label={t('console.order_customer')} sub={zoneKey ? zoneName(zoneKey) : null}>
        <PersonName id={o.ordererId} copy={false} strong />
      </Fact>
      <Fact
        label={ride ? t('console.order_driver') : t('console.order_courier')}
        sub={
          courierId ? (
            <>
              {vehicle ? (
                <>
                  {vehicle}
                  <span aria-hidden className="mx-1 text-faint">
                    ·
                  </span>
                </>
              ) : null}
              <Link href={`/drivers/${encodeURIComponent(courierId)}/ledger`} className="rounded font-medium text-accent-text hover:underline">
                {t('console.order_courier_ledger')}
              </Link>
            </>
          ) : null
        }
      >
        {courierId ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar id={courierId} name={courier?.displayName} size="sm" />
            <PersonName id={courierId} copy={false} strong />
          </span>
        ) : (
          <span className="text-muted">{ride ? t('console.order_no_driver') : t('console.order_no_courier')}</span>
        )}
      </Fact>
      <Fact label={t('console.col_payment')} sub={cashChangeWords(o)}>
        <span className="font-semibold">{paymentLabel(o.paymentMethod)}</span>
      </Fact>
      <Fact label={t('console.col_total')} end>
        <span className="num text-lg font-bold leading-6">
          {formatIqd(o.totalIqd)} <span className="text-sm font-normal text-muted">{t('quote.currency')}</span>
        </span>
      </Fact>
    </dl>
  );
}

/**
 * "الخردة علينا" under the payment: the note the customer said at checkout and, after the door, the
 * change that went to his wallet because the courier had none. Null when neither.
 */
function cashChangeWords(o: Order): string | undefined {
  if (o.paymentMethod !== 'cash') return undefined;
  if (o.changeToWalletIqd) return t('cashchange.console_change', { amount: formatIqd(o.changeToWalletIqd) });
  if (o.statedTenderIqd && o.statedTenderIqd > o.totalIqd) return t('cashchange.console_tender', { amount: formatIqd(o.statedTenderIqd) });
  return undefined;
}

function Fact({ label, sub, children, end }: { label: string; sub?: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <div className={cx('min-w-0 border-line px-6 py-4 md:[&:not(:first-child)]:border-s', end && 'md:text-end')}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm leading-6">{children}</dd>
      {sub ? <dd className="truncate text-xs leading-5 text-muted">{sub}</dd> : null}
    </div>
  );
}

// ───────────────────────── the story (K-22) ─────────────────────────

function stepLabel(step: StoryStep, ride: boolean): string {
  if (ride && (step.key === 'picked_up' || step.key === 'delivered')) return t(`console.order_story_${step.key}_ride` as MessageKey);
  return t(`console.order_story_${step.key}` as MessageKey);
}

function secondsText(sec: number): string {
  return sec < 60 ? t('console.order_dispatch_seconds', { n: sec }) : compactDuration(sec * 1000);
}

function Story({ o, events, now, logError }: { o: Order; events: LogEntry[]; now: Date; logError: { message: string } | null }) {
  const [all, setAll] = useState(false);
  const steps = useMemo(() => orderStory(o), [o]);
  const total = storyTotalMin(steps);
  const ride = RIDE_TYPES.has(o.type);
  const dispatch = useMemo(() => dispatchSummary(events), [events]);
  const lastDone = steps.reduce((i, s, j) => (s.at ? j : i), 0);
  const waiting = steps.find((s) => !s.at);
  const waitedMin = waiting && steps[lastDone]?.at ? Math.max(0, Math.round((now.getTime() - steps[lastDone]!.at!.getTime()) / 60_000)) : null;
  const cancelled = steps.at(-1)?.key === 'cancelled';
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 id="order-story" className="text-[15px] font-semibold">
          {t('console.order_story')}
        </h2>
        {total !== null ? (
          <p className={cx('num text-sm', cancelled ? 'text-muted' : 'text-text')}>
            {cancelled ? t('console.order_story_total_cancelled', { time: compactDuration(total * 60_000) }) : t('console.order_story_total', { time: compactDuration(total * 60_000) })}
          </p>
        ) : null}
      </div>

      {/* The four moments, right to left like the sentence they make. */}
      <p className="sr-only">{storySentence(steps, ride)}</p>
      <ol aria-hidden className="flex items-start px-6 pb-5 pt-6">
        {steps.map((s, i) => {
          const done = s.at !== null;
          const current = i === lastDone && !waiting && !cancelled ? false : i === lastDone && Boolean(waiting);
          const bad = s.key === 'cancelled';
          return (
            <li key={s.key} className={cx('flex min-w-0 items-start', i < steps.length - 1 ? 'flex-1' : 'shrink-0')}>
              <div className="flex w-28 shrink-0 flex-col items-center text-center">
                <span
                  aria-hidden
                  className={cx(
                    'relative mt-0.5 h-3.5 w-3.5 rounded-pill',
                    bad ? 'bg-bad-solid' : done ? (current ? 'bg-accent ring-4 ring-accent-tint' : 'bg-text') : 'border-2 border-dashed border-line-strong bg-surface',
                  )}
                />
                <span className={cx('mt-2.5 text-sm leading-5', done ? 'font-semibold text-text' : 'text-muted')}>{done ? stepLabel(s, ride) : `${t('console.order_story_waiting')}: ${stepLabel(s, ride)}`}</span>
                <span className="num mt-0.5 text-dense text-muted">
                  {s.at ? formatClock(s.at) : waitedMin === null ? '' : waitedMin < 1 ? t('console.order_story_waiting_just') : t('console.order_story_waiting_for', { time: compactDuration(waitedMin * 60_000) })}
                </span>
              </div>
              {i < steps.length - 1 ? (
                <div className="relative mt-[7px] h-6 min-w-6 flex-1" aria-hidden={steps[i + 1]!.sinceMin === null}>
                  <span className={cx('absolute inset-x-1 top-0 h-0.5 rounded-pill', steps[i + 1]!.at ? 'bg-text/70' : 'bg-line-strong/60 [background-image:repeating-linear-gradient(90deg,transparent_0_4px,rgb(var(--c-surface))_4px_8px)]')} />
                  {steps[i + 1]!.sinceMin ? (
                    <span className="num absolute inset-x-0 top-2 text-center text-xs text-muted">{compactDuration(steps[i + 1]!.sinceMin! * 60_000)}</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
        {dispatch ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-dense text-muted">
            <IconDispatch size={16} className="shrink-0" />
            <span className="num">{countText('console.order_dispatch_offered', dispatch.offered)}</span>
            {dispatch.missed > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="num">{countText('console.order_dispatch_missed', dispatch.missed)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            {dispatch.acceptedBy ? (
              <span className="inline-flex items-center gap-1">
                {t('console.order_dispatch_taken')} <PersonName id={dispatch.acceptedBy} copy={false} strong />
                {dispatch.acceptedAfterSec !== null ? <span className="num">{t('console.order_dispatch_after', { time: secondsText(dispatch.acceptedAfterSec) })}</span> : null}
              </span>
            ) : (
              <span>{t('console.order_dispatch_waiting')}</span>
            )}
            {dispatch.manual ? (
              <>
                <span aria-hidden>·</span>
                <span>{t('console.order_dispatch_manual')}</span>
              </>
            ) : null}
          </p>
        ) : (
          <span />
        )}
        {events.length > 0 ? (
          <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="rounded-md text-dense font-medium text-accent-text hover:underline">
            {all ? t('console.order_events_less') : t('console.order_events_all', { n: events.length })}
          </button>
        ) : null}
      </div>
      {logError ? (
        <div className="border-t border-line px-6 py-3">
          <QueryError error={logError} />
        </div>
      ) : null}
      {all ? (
        <div className="border-t border-line px-6 py-5">
          <Timeline
            className="max-w-lg"
            items={events.map((e) => ({
              id: e.id,
              title: (
                <span title={e.type}>
                  {e.label}
                  {e.quarantined ? (
                    <Chip tone="bad" size="sm" className="ms-2" title={e.quarantineReason ?? undefined}>
                      {t('console.event_quarantined')}
                    </Chip>
                  ) : null}
                  {e.flagged ? (
                    <Chip tone="warn" size="sm" className="ms-2" title={e.flagReason ?? undefined}>
                      {t('console.event_skew')}
                    </Chip>
                  ) : null}
                </span>
              ),
              time: formatClock(e.at),
              meta: <PersonName id={e.actorId} copy={false} />,
              tone: e.quarantined ? 'bad' : undefined,
            }))}
          />
        </div>
      ) : null}
    </>
  );
}

/** "انطلب 10:08 م، قبله المطعم 10:09 م، طلع الدليفري 10:31 م، وصل 10:52 م" (for screen readers). */
function storySentence(steps: readonly StoryStep[], ride: boolean): string {
  return steps
    .filter((s) => s.at)
    .map((s) => `${stepLabel(s, ride)} ${formatClock(s.at!)}`)
    .join(t('console.list_sep'));
}

// ───────────────────────── main: the order and its money, or its chats ─────────────────────────

function MainPanel({ o }: { o: Order }) {
  const [tab, setTab] = useState<'details' | 'chats'>('details');
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface shadow-card">
      <Tabs
        label={t('console.order_tabs')}
        value={tab}
        onChange={setTab}
        className="px-6"
        options={[
          { value: 'details', label: t('console.order_tab_details') },
          { value: 'chats', label: t('console.order_tab_chats') },
        ]}
      />
      <div role="tabpanel">{tab === 'details' ? <OrderMoney o={o} /> : <Chats orderId={o.id} />}</div>
    </section>
  );
}

function OrderMoney({ o }: { o: Order }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const ledger = useQuery(trpc.orders.ledger.queryOptions({ orderId: o.id }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS * 2 }));
  const groups = useMemo(() => groupLinesByParticipant(o), [o]);
  const money = useMemo(() => moneyLines(ledger.data ?? []), [ledger.data]);
  const check = priceCheck(o);
  const paid = o.state === 'delivered' || o.state === 'completed' || o.state === 'closed';
  return (
    <div className="divide-y divide-line">
      {/* Items, by person */}
      <div className="px-6 py-5">
        {groups.map((g) => {
          const name = g.participant ? (g.participant.label ?? participantRoleLabel(g.participant.role)) : null;
          return (
            <div key={g.participant?.id ?? 'orderer'} className="mb-4 last:mb-0">
              {name ? (
                <p className="mb-1.5 flex items-center gap-2 text-dense font-semibold">
                  {name}
                  {g.participant?.phoneOnly ? (
                    <Chip tone="warn" size="sm">
                      {t('console.order_phone_only')}
                    </Chip>
                  ) : null}
                </p>
              ) : null}
              {g.lines.length === 0 ? (
                <p className="text-dense text-faint">{t('console.order_no_lines')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {g.lines.map((l) => (
                    <li key={l.id} className={cx('flex items-baseline justify-between gap-4 text-sm', l.availability === 'removed' && 'text-faint line-through')}>
                      <span className="min-w-0">
                        <span className="num me-1.5 text-muted">{l.qty}×</span>
                        {l.freeText ?? (l.catalogItemId ? <ItemName orgId={o.merchantOrgId} itemId={l.catalogItemId} /> : <Mono>{l.id}</Mono>)}
                        {l.availability !== 'available' ? (
                          <Chip tone="bad" size="sm" className="ms-2">
                            {l.availability === 'removed' ? t('console.order_line_removed') : t('console.order_line_unavailable')}
                          </Chip>
                        ) : null}
                        {l.note ? <span className="block text-xs text-muted">{l.note}</span> : null}
                      </span>
                      <span className="num shrink-0">{formatIqd(lineTotal(l))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* The bill */}
      <dl className="px-6 py-4 text-sm">
        {priceRows(o).map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-muted">{priceLabel(r.key)}</dt>
            <dd className={cx('num', r.key === 'discount' && 'text-ok')}>{formatIqd(Math.abs(r.amountIqd))}</dd>
          </div>
        ))}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold">{t('console.col_total')}</dt>
          <dd className="num text-lg font-bold">
            {formatIqd(o.totalIqd)} <span className="text-sm font-normal text-muted">{t('quote.currency')}</span>
          </dd>
        </div>
        {paid ? <p className="mt-1 text-dense text-muted">{t('console.order_money_paid', { amount: formatIqd(o.totalIqd), method: paymentLabel(o.paymentMethod) })}</p> : null}
        {/* "الخردة علينا": no change on the courier — the whole note on him, the rest the customer's credit. */}
        {o.changeToWalletIqd ? (
          <p className="num mt-1 text-dense font-medium text-ok" data-testid="order-change-to-wallet">
            {t('cashchange.console_paid_note', { collected: formatIqd(o.totalIqd + o.changeToWalletIqd), change: formatIqd(o.changeToWalletIqd) })}
          </p>
        ) : null}
        {!check.matches ? <p className="mt-1 text-xs text-faint">{t('console.order_sum_mismatch', { sum: formatIqd(check.sumIqd), total: formatIqd(o.totalIqd) })}</p> : null}
      </dl>

      {/* Where the money went, in words */}
      <div className="px-6 py-5">
        <h3 className="mb-3 text-[15px] font-semibold">{t('console.order_money_where')}</h3>
        {ledger.error ? <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} /> : null}
        {ledger.isPending ? <Skeleton className="h-16" /> : null}
        {ledger.isSuccess && money.length === 0 ? <p className="text-dense text-muted">{t('console.order_money_none')}</p> : null}
        {money.length > 0 ? (
          <ul className="divide-y divide-line/70">
            {money.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0">
                  <span className={cx('font-semibold', m.head === 'on_courier' ? 'text-warn' : m.head === 'to_customer' ? 'text-accent-text' : 'text-text')}>{t(`console.money_${m.head}` as MessageKey)}</span>
                  <span className="ms-2 text-dense text-muted">{m.label}</span>
                </span>
                <span className="num shrink-0 font-medium">
                  {formatIqd(m.amountIqd)} <span className="text-xs font-normal text-muted">{t('quote.currency')}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** The order's chat threads, read only (the desk never writes in them). */
function Chats({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const threads = useQueries({
    queries: ChatThreadKind.options.map((kind) => trpc.chat.thread.queryOptions({ orderId, kind }, { enabled: signedIn, retry: false, refetchInterval: 10_000 })),
  });
  const kinds = ChatThreadKind.options.filter((_, i) => (threads[i]?.data?.messages.length ?? 0) > 0);
  const [pick, setPick] = useState<ChatKind | null>(null);
  const kind = pick && kinds.includes(pick) ? pick : (kinds[0] ?? null);
  const thread = kind ? threads[ChatThreadKind.options.indexOf(kind)]?.data : undefined;
  const loading = threads.some((q) => q.isPending);
  return (
    <div className="px-6 py-5">
      <p className="mb-4 flex items-center gap-2 text-xs text-muted">
        <IconLock size={13} />
        {t('console.sup_chats_hint')}
      </p>
      {loading ? <Skeleton className="h-24" /> : null}
      {!loading && kinds.length === 0 ? <EmptyState bare icon={<IconChat size={20} />} title={t('console.order_chat_none')} /> : null}
      {kinds.length > 1 && kind ? (
        <Segmented size="sm" className="mb-4" label={t('console.order_tab_chats')} value={kind} onChange={setPick} options={kinds.map((k) => ({ value: k, label: t(`console.sup_chat_${k}` as MessageKey) }))} />
      ) : kind ? (
        <p className="mb-4 text-dense font-semibold">{t(`console.sup_chat_${kind}` as MessageKey)}</p>
      ) : null}
      {thread ? (
        <ol className="flex flex-col gap-2.5">
          {thread.messages.map((m) => {
            const start = m.senderRole === 'customer' || (kind === 'merchant_courier' && m.senderRole === 'merchant');
            return (
              <li key={m.id} className={cx('flex', start ? 'justify-start' : 'justify-end')}>
                <div className={cx('max-w-[78%] rounded-xl px-3.5 py-2', m.senderRole === 'customer' ? 'border border-line bg-surface' : m.senderRole === 'merchant' ? 'bg-info-tint' : m.senderRole === 'courier' ? 'bg-surface-3' : 'bg-accent-tint')}>
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-text">{t(`console.sup_role_${m.senderRole}` as MessageKey)}</span>
                    <span className="num"> · {formatClock(m.createdAt)}</span>
                    {m.masked ? <span className="text-warn"> · {t('console.sup_masked')}</span> : null}
                  </p>
                  <p className="text-sm leading-6">{m.kind === 'voice' ? <ChatVoiceNote m={m} /> : (m.text ?? (m.photoUrl ? t('console.sup_photo') : m.location ? t('console.sup_location') : '—'))}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

// ───────────────────────── side: the rest of the order ─────────────────────────

/** The order's other facts, only the ones it has (note, schedule, promise, vehicle, refund…). */
function detailRows(o: Order, now: Date): Array<[string, ReactNode]> {
  const rows: Array<[string, ReactNode]> = [];
  if (o.note) rows.push([t('console.order_note'), o.note]);
  if (o.scheduledFor) rows.push([t('console.step_scheduled'), <span key="s" className="num">{stamp(o.scheduledFor, now)}</span>]);
  if (o.promisedReadyAt) rows.push([t('console.order_promised_ready_short'), <span key="p" className="num">{formatClock(o.promisedReadyAt)}</span>]);
  if (o.minVehicleClass) rows.push([t('console.order_vehicle'), vehicleLabel(o.minVehicleClass)]);
  if (o.cateringRequest)
    rows.push([
      t('console.order_catering'),
      <span key="c" className="inline-flex items-center gap-1">
        <IconCheck size={14} className="text-ok" />
        {t('console.yes')}
      </span>,
    ]);
  if (o.refundState !== 'none') rows.push([t('console.order_refund'), t(`console.refund_state_${o.refundState}` as MessageKey)]);
  if (o.cancellationReason) rows.push([t('console.order_cancel_reason'), o.cancellationReason]);
  return rows;
}

function DetailsCard({ o, rows }: { o: Order; rows: Array<[string, ReactNode]> }) {
  return (
    <Card title={t('console.order_detail_rows')}>
      {rows.length > 0 ? (
        <dl>
          {rows.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </dl>
      ) : null}
      {o.partial ? (
        <p role="status" className="mt-3 rounded-md bg-warn-tint px-3 py-2 text-sm text-text">
          {t('console.order_partial', { amount: formatIqd(o.partial.reducedTotalIqd), time: formatClock(o.partial.deadline) })}
        </p>
      ) : null}
    </Card>
  );
}
