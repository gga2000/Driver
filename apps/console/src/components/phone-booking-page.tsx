'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PHONE_BOOKING_RULES, type LandmarkView, type PhoneBookingOption, type PhoneBookingRow, type PhoneBookingVertical } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useDeferredValue, useId, useState } from 'react';
import { formatClock, formatIqd } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText, useConsoleNetwork } from '@/lib/network';
import { callerPhone, filterPlaces, formatCallerPhone, MISSING_KEY, missingParts, newBookingKey, STATUS_KEY, statusTone, VEHICLE_KEY, type PhoneBookingForm } from '@/lib/phone-booking';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, EmptyState, Field, IconPhone, IconPin, IconSearch, Input, NeedLogin, PageHeader, QueryError, Skeleton, Spinner, Textarea, useToast } from './ui';

const EMPTY: PhoneBookingForm = { phone: '', name: '', pickupId: null, dropoffId: null, vertical: 'taxi', note: '' };

/**
 * Console › حجز بالتلفون (taxi/tuktuk step 4): someone without the app calls; staff type the number
 * and name, pick منين/لوين from the city's landmarks, read the server's price to the caller and book
 * an ordinary cash ride on his number (`phoneBookings.*`, support, dispatchers and admins). Today's
 * phone bookings follow live with the driver and plate once taken, and a cancel that shows its fee.
 */
export function PhoneBookingPage() {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('console.phone.title')} subtitle={t('console.phone.subtitle')} />
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <BookingForm />
          <TodayList />
        </div>
      )}
    </div>
  );
}

// ───────────────────────── the form ─────────────────────────

function BookingForm() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const net = useConsoleNetwork();
  const offline = net.state === 'offline';
  const [form, setForm] = useState<PhoneBookingForm>(EMPTY);
  const [bookingKey, setBookingKey] = useState(() => newBookingKey());
  const set = (patch: Partial<PhoneBookingForm>) => setForm((f) => ({ ...f, ...patch }));

  const phone = callerPhone(form.phone);
  const caller = useQuery(trpc.phoneBookings.caller.queryOptions({ phone: phone ?? '' }, { enabled: phone !== null, retry: queryRetry, staleTime: 60_000 }));
  const landmarks = useQuery(trpc.places.landmarks.queryOptions({ cityId: CITY_ID }, { retry: queryRetry, staleTime: 10 * 60_000 }));
  const places = landmarks.data ?? [];
  const pickup = places.find((p) => p.id === form.pickupId) ?? null;
  const dropoff = places.find((p) => p.id === form.dropoffId) ?? null;
  const samePlace = form.pickupId !== null && form.pickupId === form.dropoffId;
  const canQuote = pickup !== null && dropoff !== null && !samePlace;
  const quote = useQuery(
    trpc.phoneBookings.quote.queryOptions({ cityId: CITY_ID, pickupId: form.pickupId ?? '', dropoffId: form.dropoffId ?? '' }, { enabled: canQuote, retry: queryRetry, refetchInterval: 60_000 }),
  );
  const option: PhoneBookingOption | null = canQuote ? (quote.data?.options.find((o) => o.vertical === form.vertical) ?? null) : null;
  const missing = missingParts(form, option !== null);

  const book = useMutation(
    trpc.phoneBookings.book.mutationOptions({
      onSuccess: (row) => {
        toast({ title: t('console.phone.booked', { vehicle: t(VEHICLE_KEY[row.vertical]), name: row.callerName ?? t('console.phone.caller_unnamed') }), tone: 'ok' });
        setForm(EMPTY);
        setBookingKey(newBookingKey());
        void qc.invalidateQueries({ queryKey: trpc.phoneBookings.today.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.phoneBookings.caller.queryKey() });
      },
      onError: (e) => {
        if (e.data && (e.data as { code?: string }).code === 'price_changed') {
          toast({ title: t('console.phone.price_changed'), tone: 'bad' });
          setBookingKey(newBookingKey());
          void quote.refetch();
          return;
        }
        toast({ title: t('console.phone.book_failed', { message: errorText(e) }), tone: 'bad' });
      },
    }),
  );

  function submit() {
    if (!phone || !option || !form.pickupId || !form.dropoffId) return;
    const note = form.note.trim();
    book.mutate({
      cityId: CITY_ID,
      phone,
      name: form.name.trim(),
      pickupId: form.pickupId,
      dropoffId: form.dropoffId,
      vertical: form.vertical,
      fareIqd: option.fareIqd,
      ...(note ? { note } : {}),
      clientRequestId: bookingKey,
    });
  }

  const phoneTyped = form.phone.replace(/\D/g, '').length >= 10;
  const knownName = caller.data?.known ? caller.data.name : null;

  return (
    <Card title={t('console.phone.form')}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('console.phone.phone')} htmlFor="pb-phone" error={phoneTyped && !phone ? t('console.phone.phone_invalid') : undefined} hint={phone ? <CallerLine state={caller} /> : undefined}>
          <Input
            id="pb-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            className="h-11 text-end text-base tabular-nums"
            placeholder={t('console.phone.phone_placeholder')}
            aria-invalid={phoneTyped && !phone}
            value={form.phone}
            onChange={(e) => set({ phone: formatCallerPhone(e.target.value) })}
          />
        </Field>

        <Field label={t('console.phone.name')} htmlFor="pb-name" hint={knownName ? t('console.phone.name_known_hint', { name: knownName }) : t('console.phone.name_hint')}>
          <Input
            id="pb-name"
            autoComplete="off"
            className="h-11"
            maxLength={PHONE_BOOKING_RULES.nameMaxChars}
            placeholder={knownName ?? t('console.phone.name_placeholder')}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            onFocus={() => {
              if (!form.name && knownName) set({ name: knownName });
            }}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <PlacePicker label={t('console.phone.pickup')} places={places} state={landmarks} value={pickup} onChange={(p) => set({ pickupId: p?.id ?? null })} />
          <PlacePicker label={t('console.phone.dropoff')} places={places} state={landmarks} value={dropoff} onChange={(p) => set({ dropoffId: p?.id ?? null })} />
        </div>
        {samePlace ? (
          <p role="alert" className="-mt-2 text-sm text-bad">
            {t('console.phone.same_place')}
          </p>
        ) : null}

        <section aria-labelledby="pb-vehicle">
          <h3 id="pb-vehicle" className="mb-2 text-dense font-semibold text-text">
            {t('console.phone.vehicle')}
          </h3>
          {!canQuote ? (
            <p className="rounded-md border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{t('console.phone.quote_pick')}</p>
          ) : quote.error ? (
            <QueryError error={quote.error} onRetry={() => void quote.refetch()} />
          ) : !quote.data ? (
            <div className="grid grid-cols-2 gap-3" aria-busy aria-label={t('console.phone.quote_loading')}>
              <Skeleton className="h-[92px] rounded-md" />
              <Skeleton className="h-[92px] rounded-md" />
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-labelledby="pb-vehicle" className="grid grid-cols-2 gap-3">
                {quote.data.options.map((o) => (
                  <VehicleOption key={o.vertical} option={o} selected={o.vertical === form.vertical} onPick={() => set({ vertical: o.vertical })} />
                ))}
              </div>
              {option && pickup && dropoff ? (
                <p className="mt-3 rounded-md bg-accent-tint px-3 py-2 text-sm text-text">
                  {t('console.phone.say', { vehicle: t(VEHICLE_KEY[option.vertical]), from: pickup.name_ar, to: dropoff.name_ar, amount: formatIqd(option.totalIqd) })}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">{t('console.phone.quote_hint')}</p>
            </>
          )}
        </section>

        <Field label={t('console.phone.note')} htmlFor="pb-note" hint={t('console.phone.note_left', { count: PHONE_BOOKING_RULES.noteMaxChars - form.note.length })}>
          <Textarea id="pb-note" rows={2} maxLength={PHONE_BOOKING_RULES.noteMaxChars} placeholder={t('console.phone.note_placeholder')} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-[48ch] text-xs text-muted">{offline ? t('console.net_offline') : missing.length > 0 ? t('console.phone.book_missing', { what: missing.map((m) => t(MISSING_KEY[m])).join(t('console.list_sep')) }) : t('console.phone.audited')}</p>
          <Button type="submit" size="lg" variant="primary" icon={<IconPhone size={18} />} loading={book.isPending} disabled={missing.length > 0 || offline}>
            {t('console.phone.book')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CallerLine({ state }: { state: { data?: { known: boolean; name: string | null; phoneRides: number } | undefined; isPending: boolean; error: unknown } }) {
  if (state.error) return null;
  if (!state.data) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Spinner /> {t('console.phone.caller_checking')}
      </span>
    );
  }
  const c = state.data;
  const who = c.known ? (c.name ? t('console.phone.caller_known', { name: c.name }) : t('console.phone.caller_known_noname')) : t('console.phone.caller_new');
  return (
    <span>
      {who}
      {c.phoneRides > 0 ? ` · ${t('console.phone.caller_rides', { n: c.phoneRides })}` : ''}
    </span>
  );
}

function VehicleOption({ option, selected, onPick }: { option: PhoneBookingOption; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cx(
        'flex min-h-[92px] flex-col items-start justify-center gap-1 rounded-md border px-4 py-3 text-start transition-colors duration-fast',
        selected ? 'border-accent-text bg-accent-tint' : 'border-line-strong/80 bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <span className="text-sm font-semibold text-text">{t(VEHICLE_KEY[option.vertical])}</span>
      <span className="text-lg font-semibold tabular-nums text-text">{t('console.phone.total', { amount: formatIqd(option.totalIqd) })}</span>
      {option.rideMin > 0 ? <span className="text-xs text-muted">{t('console.phone.ride_min', { minutes: option.rideMin })}</span> : null}
    </button>
  );
}

function PlacePicker({ label, places, state, value, onChange }: { label: string; places: LandmarkView[]; state: { error: unknown; isPending: boolean; refetch: () => unknown }; value: LandmarkView | null; onChange: (p: LandmarkView | null) => void }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const matches = filterPlaces(places, deferred, 8);
  const choose = (p: LandmarkView | null) => {
    setQuery('');
    setOpen(p === null);
    onChange(p);
  };

  if (value) {
    return (
      <div>
        <span className="mb-1.5 block text-dense font-medium text-text">{label}</span>
        <div className="flex min-h-11 items-center gap-2 rounded-md border border-line-strong/80 bg-surface-2 ps-3 pe-1">
          <IconPin size={16} className="shrink-0 text-accent-text" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{value.name_ar}</span>
          <Button
            size="md"
            variant="ghost"
            className="min-h-11"
            aria-label={t('console.phone.place_clear', { name: value.name_ar })}
            onClick={() => choose(null)}
          >
            {t('console.phone.place_change')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-dense font-medium text-text">
        {label}
      </label>
      <Input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        className="h-11"
        leading={<IconSearch size={16} />}
        placeholder={t('console.phone.place_search')}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault();
            choose(matches[0]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-raised p-1 shadow-pop">
          {state.error ? (
            <li className="px-3 py-2 text-sm text-bad">{errorText(state.error as Parameters<typeof errorText>[0])}</li>
          ) : places.length === 0 && state.isPending ? (
            <li className="px-3 py-2 text-sm text-muted">{t('console.phone.place_loading')}</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t('console.phone.place_none')}</li>
          ) : (
            matches.map((p) => (
              <li
                key={p.id}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] px-3 py-1.5 text-sm text-text hover:bg-surface-2"
              >
                <IconPin size={14} className="shrink-0 text-muted" />
                <span className="truncate">{p.name_ar}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// ───────────────────────── today's list ─────────────────────────

function TodayList() {
  const trpc = useTRPC();
  const today = useQuery(trpc.phoneBookings.today.queryOptions({ cityId: CITY_ID }, { retry: queryRetry, refetchInterval: PHONE_BOOKING_RULES.listRefreshMs }));
  const [cancelling, setCancelling] = useState<PhoneBookingRow | null>(null);
  const rows = today.data ?? [];
  return (
    <Card title={t('console.phone.today')} hint={rows.length > 0 ? t('console.phone.today_hint', { n: rows.length }) : undefined} flush>
      {today.error ? (
        <div className="px-5 pb-5">
          <QueryError error={today.error} onRetry={() => void today.refetch()} />
        </div>
      ) : null}
      {!today.data && today.isPending ? (
        <div className="space-y-3 px-5 pb-5" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
      ) : null}
      {today.data && rows.length === 0 ? <EmptyState bare icon={<IconPhone size={20} />} title={t('console.phone.empty')} hint={t('console.phone.empty_hint')} className="pb-6" /> : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {rows.map((r) => (
            <li key={r.orderId}>
              <BookingRow row={r} onCancel={() => setCancelling(r)} />
            </li>
          ))}
        </ul>
      ) : null}
      {cancelling ? <CancelDialog row={cancelling} onClose={() => setCancelling(null)} /> : null}
    </Card>
  );
}

function BookingRow({ row, onCancel }: { row: PhoneBookingRow; onCancel: () => void }) {
  const name = row.callerName ?? t('console.phone.caller_unnamed');
  const d = row.driver;
  const driverLine = d ? [d.firstName ?? t('console.phone.driver_unnamed'), d.vehicleLabel, d.plate ? t('console.phone.plate', { plate: d.plate }) : null].filter(Boolean).join(' · ') : null;
  return (
    <div className={cx('px-5 py-3.5', row.status === 'cancelled' && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">
            {name} <span className="font-normal text-muted tabular-nums" dir="ltr">{row.phoneHint}</span>
          </p>
          <p className="truncate text-sm text-text">{t('console.phone.route', { from: row.pickupName, to: row.dropoffName })}</p>
        </div>
        <Chip tone={statusTone(row.status)} dot>
          {t(STATUS_KEY[row.status])}
        </Chip>
      </div>
      <p className="mt-1 text-xs text-muted">
        <span className="tabular-nums">{row.ticket}</span> · {t(VEHICLE_KEY[row.vertical as PhoneBookingVertical])} · <span className="tabular-nums">{t('console.phone.total', { amount: formatIqd(row.totalIqd) })}</span> · {t('console.phone.since', { time: formatClock(row.since) })}
        {row.bookedByName ? ` · ${t('console.phone.booked_by', { name: row.bookedByName })}` : ''}
      </p>
      {driverLine ? <p className="mt-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-text">{driverLine}</p> : null}
      {row.note ? <p className="mt-1.5 text-xs text-muted">{row.note}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={`/orders/${encodeURIComponent(row.orderId)}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-accent-text hover:bg-surface-2">
          {t('console.phone.open_order')}
        </Link>
        {row.cancellable ? (
          <Button size="md" variant="danger-soft" className="min-h-11" onClick={onCancel}>
            {t('console.phone.cancel')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CancelDialog({ row, onClose }: { row: PhoneBookingRow; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const name = row.callerName ?? t('console.phone.caller_unnamed');
  const preview = useQuery(trpc.phoneBookings.cancelPreview.queryOptions({ orderId: row.orderId }, { retry: queryRetry, staleTime: 0 }));
  const cancel = useMutation(
    trpc.phoneBookings.cancel.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.phone.cancelled_toast', { name }), tone: 'ok' });
        void qc.invalidateQueries({ queryKey: trpc.phoneBookings.today.queryKey() });
        onClose();
      },
      onError: (e) => toast({ title: t('console.phone.cancel_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const fee = preview.data;
  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('console.phone.cancel_title', { name })}
      description={t('console.phone.route', { from: row.pickupName, to: row.dropoffName })}
      footer={
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('console.phone.cancel_keep')}
          </Button>
          <Button size="lg" variant="danger" loading={cancel.isPending} disabled={!fee || !fee.allowed} onClick={() => cancel.mutate({ orderId: row.orderId })}>
            {t('console.phone.cancel_confirm')}
          </Button>
        </>
      }
    >
      {preview.error ? (
        <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
      ) : !fee ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t('console.phone.cancel_checking')}
        </p>
      ) : (
        <p className={cx('text-sm', fee.allowed ? 'text-text' : 'text-bad')}>
          {!fee.allowed ? t('console.phone.cancel_not_allowed') : fee.amountIqd > 0 ? t('console.phone.cancel_fee', { amount: formatIqd(fee.amountIqd) }) : t('console.phone.cancel_free')}
        </p>
      )}
    </Dialog>
  );
}
