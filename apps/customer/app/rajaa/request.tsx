import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { IntercityVehicleKind, REQUEST_WAIT_HOURS_MAX, requestDetailsProblem, type RequestDetails, type RequestPostView, type RequestTripKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Chip, ChipGroup, Icon, SegmentedControl, Skeleton, StatusPill, Stepper, Text, TextField, useTheme, useToast, type StatusTone } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { requestStateLabel, seatsCount, slotLabel } from '@/features/rajaa/labels';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { clockLabel, depositFor, REQUEST_HOURS, requestHourAvailable, requestWhen, RIDER_TRAVELLING_AS, type RequestDay } from '@/features/rajaa/logic';
import { RuleList, Section } from '@/features/rajaa/Option';
import { useCancelRequest, useMyRequests, usePickOffer, usePostRequest, useUsualRange } from '@/features/rajaa/queries';
import { REQUEST_PLACES, OFFER_SORTS, offerWinners, placeIdFor, sortOffers, type OfferSort } from '@/features/rajaa/request-offers';
import { DetailPills, OfferCard, SeenLine, UsualRangeLine } from '@/features/rajaa/RequestParts';
import { SwitchRow } from '@/features/rajaa/SeatParts';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { countKey } from '@/lib/plural';

const TONE: Partial<Record<RequestPostView['state'], StatusTone>> = { open: 'accent', matched: 'success', driver_arrived: 'success', driver_no_show: 'danger' };

const TRIPS: readonly RequestTripKind[] = ['one_way', 'wait_return', 'two_days'];
/** Two-day trips: back after one, two or three days (the contract allows a week; these cover nearly all). */
const RETURN_DAYS = [1, 2, 3] as const;
const DAY_MS = 86_400_000;

function dayOf(when: Date, now: Date): string {
  const sameDay = Math.floor((when.getTime() + 3 * 3600_000) / 86_400_000) === Math.floor((now.getTime() + 3 * 3600_000) / 86_400_000);
  return sameDay ? 'today' : 'tomorrow';
}

/** One request with its offers; picking an offer explains the deposit first, then holds it. */
function RequestCard({ r }: { r: RequestPostView }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const pick = usePickOffer();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sort, setSort] = useState<OfferSort>('best');
  const live = r.offers.filter((o) => o.state === 'open' || o.state === 'picked');
  const offers = sortOffers(live, r.details, sort);
  const wins = offerWinners(live, r.details);
  const picked = r.offers.find((o) => o.id === r.pickedOfferId) ?? null;
  const now = new Date();

  return (
    <Card testID={`request-${r.id}`} padding={4} elevation={1}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title">
              {t('rajaa.route', { from: r.from.label, to: r.to.label })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t(dayOf(r.when, now) === 'today' ? 'rajaa.day_today' : 'rajaa.day_tomorrow')} {clockLabel(r.when)} · {seatsCount(t, r.seats)}
              {r.privateCar ? ` · ${t('rajaa.req_private_short')}` : ''}
            </Text>
          </View>
          <StatusPill size="sm" tone={TONE[r.state] ?? 'neutral'} live={r.state === 'open'} label={requestStateLabel(t, r.state)} />
        </View>
        <DetailPills details={r.details} when={r.when} testID="rajaa-req-details" />

        {r.state === 'matched' && picked ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} color="successText" testID="rajaa-req-matched">
              {t('rajaa.req_matched', { name: picked.driver?.firstName ?? t('rajaa.driver_unnamed'), amount: amountParam(picked.priceIqd) })}
            </Text>
            <RajaaDriver dep={{ vehicle: picked.driver?.vehicle ?? null }} card={picked.driver} testID="rajaa-req-matched-driver" />
            {r.depositIqd ? (
              <Text variant="footnote" color="textMuted">
                {t('request.deposit', { amount: amountParam(r.depositIqd) })}
              </Text>
            ) : null}
            <RuleList items={[t('rajaa.deposit_rule_driver'), t('rajaa.deposit_rule_rider')]} />
          </View>
        ) : null}

        {r.state === 'open' ? (
          <View style={{ gap: theme.space[3] }}>
            {/* y4: who has seen it, how many offered. */}
            <SeenLine seenBy={r.seenBy} offers={offers.length} />
            {/* p1: what this trip usually costs, from real finished trips only. */}
            {r.usualRange ? <UsualRangeLine range={r.usualRange} /> : null}
            {offers.length > 1 ? (
              <View style={{ gap: theme.space[2] }}>
                {/* y6: three orders; the winner of each is named on its card. */}
                <SegmentedControl
                  testIDPrefix="offer-sort"
                  accessibilityLabel={t('rajaa.req_sort_a11y')}
                  options={OFFER_SORTS.map((v) => ({ value: v, label: t(`rajaa.req_sort.${v}` as MessageKey) }))}
                  value={sort}
                  onChange={setSort}
                />
                <Text variant="caption" color="textMuted" testID="rajaa-offers-header">
                  {t(`rajaa.req_sort_hint.${sort}` as MessageKey)}
                </Text>
              </View>
            ) : null}
            {offers.map((o) => {
              const deposit = depositFor(o.priceIqd);
              const open = confirming === o.id;
              return (
                <OfferCard
                  key={o.id}
                  offer={o}
                  details={r.details}
                  wins={wins.get(o.id) ?? []}
                  range={r.usualRange}
                  action={!open ? <Button testID={`offer-${o.id}`} variant={(wins.get(o.id) ?? []).includes('best') ? 'primary' : 'secondary'} label={t('request.pick')} fullWidth onPress={() => setConfirming(o.id)} /> : null}
                >
                  {open ? (
                    <Card tone="sunken" elevation={0} padding={4} testID="rajaa-deposit">
                      <View style={{ gap: theme.space[3] }}>
                        <Text variant="label" weight={600}>
                          {t('rajaa.deposit_title', { amount: amountParam(deposit) })}
                        </Text>
                        <Text variant="footnote" color="textMuted">
                          {t('rajaa.deposit_explain')}
                        </Text>
                        <RuleList items={[t('rajaa.deposit_rule_driver'), t('rajaa.deposit_rule_rider')]} />
                        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                          <Button
                            testID="rajaa-deposit-confirm"
                            style={{ flex: 1 }}
                            label={t('rajaa.deposit_confirm')}
                            loading={pick.isPending}
                            onPress={() =>
                              pick.mutate(
                                { postId: r.id, offerId: o.id },
                                {
                                  onSuccess: () => setConfirming(null),
                                  onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000),
                                },
                              )
                            }
                          />
                          <Button variant="secondary" label={t('action.back')} onPress={() => setConfirming(null)} />
                        </View>
                      </View>
                    </Card>
                  ) : null}
                </OfferCard>
              );
            })}
          </View>
        ) : null}

        {r.state === 'open' ? (
          <Button
            variant="ghost"
            size="sm"
            label={t('rajaa.req_cancel')}
            loading={cancel.isPending}
            onPress={() => cancel.mutate({ postId: r.id }, { onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }) })}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Request board (spec §2): trips to other destinations and private cars. Post from/to, day and
 * time, seats, private car and a note; drivers' offers arrive with prices; picking one holds a 20 %
 * deposit on the wallet after the rules are shown.
 */
export default function RequestBoard() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const mine = useMyRequests();
  const post = usePostRequest();
  const now = useMemo(() => new Date(), []);

  const [composing, setComposing] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [day, setDay] = useState<RequestDay>(REQUEST_HOURS.some((h) => requestHourAvailable('today', h, now)) ? 'today' : 'tomorrow');
  const [hour, setHour] = useState<number>(REQUEST_HOURS.find((h) => requestHourAvailable('today', h, now)) ?? REQUEST_HOURS[0]);
  const [seats, setSeats] = useState(1);
  const [privateCar, setPrivateCar] = useState(true);
  const [note, setNote] = useState('');
  // y1: the trip kind and what the car needs.
  const [trip, setTrip] = useState<RequestTripKind>('one_way');
  const [waitHours, setWaitHours] = useState(3);
  const [backAfter, setBackAfter] = useState<number>(1);
  const [backHour, setBackHour] = useState<number>(16);
  const [bigBags, setBigBags] = useState(0);
  const [carKind, setCarKind] = useState<RequestDetails['carKind']>(null);
  const [ac, setAc] = useState(false);

  const active = (mine.data ?? []).filter((r) => r.state === 'open' || r.state === 'matched' || r.state === 'driver_arrived');
  const showForm = composing || (!mine.isPending && active.length === 0);
  const hourOk = requestHourAvailable(day, hour, now);
  const when = requestWhen(day, hour, now);
  const details: RequestDetails = {
    trip,
    waitHours: trip === 'wait_return' ? waitHours : null,
    returnAt: trip === 'two_days' ? new Date(requestWhen(day, backHour, now).getTime() + backAfter * DAY_MS) : null,
    bigBags,
    carKind,
    ac,
  };
  // p1: a destination picked from (or typed as) a chip has a usual range once enough trips finished.
  const placeId = placeIdFor(to, (id) => t(`rajaa.req_place.${id}` as MessageKey));
  const range = useUsualRange(privateCar ? placeId : null, trip);
  const ready = from.trim().length > 0 && to.trim().length > 0 && hourOk && requestDetailsProblem(details, when) === null;

  const submit = () => {
    if (!ready) {
      toast.show({ message: t('rajaa.req_missing'), tone: 'warning' });
      return;
    }
    post.mutate(
      {
        from: { label: from.trim() },
        to: { label: to.trim(), ...(placeId ? { placeId } : {}) },
        when,
        seats,
        privateCar,
        // Ali dropped «منو مسافر؟» (2026-10-07); see RIDER_TRAVELLING_AS.
        travellingAs: RIDER_TRAVELLING_AS,
        ...(note.trim() ? { note: note.trim() } : {}),
        details,
      },
      {
        onSuccess: () => {
          setComposing(false);
          setFrom('');
          setTo('');
          setNote('');
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000),
      },
    );
  };

  return (
    <Screen
      testID="rajaa-request"
      edges={['bottom']}
      footer={
        showForm ? (
          <Button testID="rajaa-request-submit" size="lg" fullWidth icon="car" label={t('rajaa.req_submit')} disabled={!ready} loading={post.isPending} onPress={submit} />
        ) : (
          <Button testID="rajaa-request-new" variant="secondary" fullWidth icon="plus" label={t('rajaa.req_new')} onPress={() => setComposing(true)} />
        )
      }
    >
      <Text variant="body" color="textMuted">
        {t('rajaa.request_entry_body')}
      </Text>

      {mine.isPending ? <Skeleton height={140} radius={20} /> : null}
      {active.length > 0 ? (
        <Section title={t('rajaa.req_mine')}>
          {active.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </Section>
      ) : null}

      {showForm ? (
        <View style={{ gap: theme.space[6] }} testID="rajaa-request-form">
          <View style={{ gap: theme.space[3] }}>
            <TextField testID="rajaa-req-from" label={t('rajaa.req_from')} placeholder={t('rajaa.req_from_placeholder')} value={from} onChangeText={setFrom} maxLength={120} leadingIcon="map-pin" />
            <View style={{ flexDirection: 'row' }}>
              <Chip testID="req-from-aziziyah" icon="home" label={t('rajaa.req_from_aziziyah')} selected={from === t('rajaa.req_from_aziziyah')} onPress={() => setFrom(t('rajaa.req_from_aziziyah'))} />
            </View>
            <TextField testID="rajaa-req-to" label={t('rajaa.req_to')} placeholder={t('rajaa.req_to_placeholder')} value={to} onChangeText={setTo} maxLength={120} leadingIcon="location-arrow" />
            {/* y2: where most private trips go, one tap. */}
            <View accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.req_places_a11y')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {REQUEST_PLACES.map((p) => {
                const label = t(`rajaa.req_place.${p.id}` as MessageKey);
                return <Chip key={p.id} testID={`req-place-${p.id}`} role="radio" icon={p.icon} label={label} selected={to === label} onPress={() => setTo(label)} />;
              })}
            </View>
          </View>

          {/* y1: one way, there and back with the driver waiting, or back another day. */}
          <Section title={t('rajaa.req_trip_q')}>
            <SegmentedControl
              testIDPrefix="req-trip"
              accessibilityLabel={t('rajaa.req_trip_a11y')}
              options={TRIPS.map((v) => ({ value: v, label: t(`rajaa.req_trip.${v}` as MessageKey), detail: t(`rajaa.req_trip_detail.${v}` as MessageKey) }))}
              value={trip}
              onChange={setTrip}
            />
            {trip === 'wait_return' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="req-wait">
                <Text variant="label" weight={600} style={{ flex: 1 }}>
                  {t('rajaa.req_wait_q')}
                </Text>
                <Stepper value={waitHours} min={1} max={REQUEST_WAIT_HOURS_MAX} onChange={setWaitHours} accessibilityLabel={t('rajaa.req_wait_q')} />
                <Text variant="label" color="textMuted" tabular style={{ minWidth: 64 }}>
                  {t(countKey('rajaa.req_hours', waitHours), { n: waitHours })}
                </Text>
              </View>
            ) : null}
            {trip === 'two_days' ? (
              <View style={{ gap: theme.space[2] }} testID="req-return">
                <Text variant="label" weight={600}>
                  {t('rajaa.req_return_q')}
                </Text>
                <SegmentedControl
                  testIDPrefix="req-back"
                  accessibilityLabel={t('rajaa.req_return_a11y')}
                  options={RETURN_DAYS.map((n) => ({ value: String(n), label: t(countKey('rajaa.req_return_days', n), { n }) }))}
                  value={String(backAfter)}
                  onChange={(v) => setBackAfter(Number(v))}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                  {REQUEST_HOURS.map((h) => (
                    <Chip key={h} role="radio" label={slotLabel(t, h)} selected={backHour === h} onPress={() => setBackHour(h)} />
                  ))}
                </View>
              </View>
            ) : null}
            {range.data ? <UsualRangeLine range={range.data} testID="rajaa-form-usual-range" /> : null}
          </Section>

          <Section title={t('rajaa.req_when')}>
            <ChipGroup
              required
              items={[
                { id: 'today', label: t('rajaa.day_today') },
                { id: 'tomorrow', label: t('rajaa.day_tomorrow') },
              ]}
              value={[day]}
              onChange={(next) => setDay((next[0] as RequestDay | undefined) ?? 'today')}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {REQUEST_HOURS.map((h) => (
                <Chip
                  key={h}
                  role="radio"
                  label={slotLabel(t, h)}
                  selected={hour === h && requestHourAvailable(day, h, now)}
                  disabled={!requestHourAvailable(day, h, now)}
                  onPress={() => setHour(h)}
                />
              ))}
            </View>
          </Section>

          <Section title={t('rajaa.seats_q')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Stepper value={seats} min={1} max={7} onChange={setSeats} accessibilityLabel={t('rajaa.seats_q')} />
              <Text variant="label" color="textMuted">
                {seatsCount(t, seats)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Chip icon="car" label={t('request.private_car')} selected={privateCar} onPress={() => setPrivateCar((v) => !v)} />
            </View>
            {privateCar ? (
              <Text variant="footnote" color="textMuted">
                {t('rajaa.req_private_hint')}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="req-bags">
              <Icon name="suitcase" size={20} color="textMuted" />
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {bigBags > 0 ? t(countKey('rajaa.req_bags', bigBags), { n: bigBags }) : t('rajaa.req_bags_none')}
              </Text>
              <Stepper value={bigBags} min={0} max={7} onChange={setBigBags} accessibilityLabel={t('rajaa.req_bags_q')} />
            </View>
          </Section>

          <Section title={t('rajaa.req_car_q')} hint={t('rajaa.req_details_hint')}>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              <Chip testID="req-car-any" role="radio" label={t('rajaa.req_car_any')} selected={carKind === null} onPress={() => setCarKind(null)} />
              {IntercityVehicleKind.options.map((k) => (
                <Chip key={k} testID={`req-car-${k}`} role="radio" icon="car" label={t(`rajaa.vehicle_${k}` as MessageKey)} selected={carKind === k} onPress={() => setCarKind(k)} />
              ))}
            </View>
            <SwitchRow testID="req-ac" icon="car" label={t('rajaa.req_ac')} value={ac} onChange={setAc} />
          </Section>


          <TextField label={t('rajaa.req_note')} placeholder={t('rajaa.req_note_placeholder')} value={note} onChangeText={setNote} maxLength={300} multiline />
        </View>
      ) : null}
    </Screen>
  );
}
