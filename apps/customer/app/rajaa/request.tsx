import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { IntercityVehicleKind, REQUEST_WAIT_HOURS_MAX, requestDetailsProblem, type RequestDetails, type RequestPostView, type RequestTripKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Chip, ChipGroup, Icon, QueryBoundary, SegmentedControl, Skeleton, StatusPill, Stepper, Text, TextField, useTheme, useToast, WaitClock, type StatusTone } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useHousehold, useMe, useWalletBalance } from '@/features/account/queries';
import { requestStateLabel, seatsCount, slotLabel } from '@/features/rajaa/labels';
import { cashPhase } from '@/features/rajaa/cash';
import { CashPanel } from '@/features/rajaa/CashParts';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { TripChatEntry } from '@/features/chat/TripChatEntry';
import { clockLabel, depositFor, REQUEST_HOURS, requestHourAvailable, requestWhen, RIDER_TRAVELLING_AS, type RequestDay } from '@/features/rajaa/logic';
import { FETCH_TYPED, fetchOptions, fetchPick, fetchRiderInput, type FetchDrop } from '@/features/rajaa/fetch';
import { FetchWho, TripKindCards } from '@/features/rajaa/FetchParts';
import { RuleList, Section } from '@/features/rajaa/Option';
import { useAskCash, useCancelRequest, useMyRequests, usePickOffer, usePostRequest, useUsualRange } from '@/features/rajaa/queries';
import { REQUEST_PLACES, OFFER_SORTS, offerWinners, placeIdFor, sortOffers, type OfferSort } from '@/features/rajaa/request-offers';
import { DetailPills, OfferCard, SeenLine, UsualRangeLine } from '@/features/rajaa/RequestParts';
import { SwitchRow } from '@/features/rajaa/SeatParts';
import { BookerSharePanel } from '@/features/rajaa/ShareCarParts';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { countKey } from '@/lib/plural';
import type { TypedRiderError } from '@/features/ride/rider';

const TONE: Partial<Record<RequestPostView['state'], StatusTone>> = { open: 'accent', matched: 'success', driver_arrived: 'success', driver_no_show: 'danger' };

const TRIPS: readonly RequestTripKind[] = ['one_way', 'wait_return', 'two_days', 'fetch'];
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
  const askCash = useAskCash();
  const cancel = useCancelRequest();
  // 4b a6: «احجز وادفع كاش» is offered when the wallet can't hold the deposit (read only while it's on).
  const wallet = useWalletBalance();
  // A balance that failed to load is unknown: the ask is offered and the server decides.
  const walletIqd = r.cashReservationOn && !wallet.isError ? (wallet.data?.moneyIqd ?? null) : null;
  const failed = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sort, setSort] = useState<OfferSort>('best');
  const live = r.offers.filter((o) => o.state === 'open' || o.state === 'picked');
  const offers = sortOffers(live, r.details, sort);
  const wins = offerWinners(live, r.details);
  const picked = r.offers.find((o) => o.id === r.pickedOfferId) ?? null;
  // The waiting clock moves while the screen is open (h:mm, so every 15 s is plenty).
  const now = useNow(15_000);

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
          <StatusPill size="sm" tone={TONE[r.state] ?? 'neutral'} live={r.state === 'open'} label={r.waitClock && !r.waitClock.endedAt && r.state === 'driver_arrived' ? t('rajaa.wait_title_rider') : requestStateLabel(t, r.state)} />
        </View>
        <DetailPills details={r.details} when={r.when} riderName={r.rider?.name ?? null} testID="rajaa-req-details" />

        {(r.state === 'matched' || r.state === 'driver_arrived') && picked ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} color="successText" testID="rajaa-req-matched">
              {t('rajaa.req_matched', { name: picked.driver?.firstName ?? t('rajaa.driver_unnamed'), amount: amountParam(picked.priceIqd) })}
            </Text>
            <RajaaDriver dep={{ vehicle: picked.driver?.vehicle ?? null }} card={picked.driver} testID="rajaa-req-matched-driver" />
            <TripChatEntry subject="request" id={r.id} withId={picked.driverId} />
            {r.depositIqd ? (
              <Text variant="footnote" color="textMuted" testID="rajaa-req-deposit">
                {r.cashReserved ? t('rajaa.cash_reserved', { amount: amountParam(picked.priceIqd) }) : t('request.deposit', { amount: amountParam(r.depositIqd) })}
              </Text>
            ) : null}
            {/* w2: the same live clock the driver sees, once he starts waiting. */}
            {r.waitClock ? <WaitClock clock={r.waitClock} now={now} side="rider" locale={locale} testID="rajaa-wait-clock" /> : null}
            {r.waitClock ? null : r.cashReserved && r.depositIqd ? (
              <RuleList items={[t('rajaa.cash_rule_driver', { amount: amountParam(r.depositIqd) }), t('rajaa.cash_rule_rider', { amount: amountParam(r.depositIqd) })]} />
            ) : (
              <RuleList items={[t('rajaa.deposit_rule_driver'), t('rajaa.deposit_rule_rider')]} />
            )}
            {/* Step 6 (item 56): share the picked car by link; friends pay their places from their wallets. */}
            <BookerSharePanel r={r} dayLabel={t(dayOf(r.when, now) === 'today' ? 'rajaa.day_today' : 'rajaa.day_tomorrow')} />
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
              const cash = cashPhase(r.cashReservationOn, o, walletIqd, deposit);
              const name = o.driver?.firstName ?? t('rajaa.driver_unnamed');
              return (
                <OfferCard
                  key={o.id}
                  offer={o}
                  details={r.details}
                  wins={wins.get(o.id) ?? []}
                  range={r.usualRange}
                  action={
                    !open ? (
                      <View style={{ gap: theme.space[2] }}>
                        {cash === 'accepted' ? <StatusPill size="sm" tone="success" icon="cash" label={t('rajaa.cash_pill')} testID={`offer-cash-${o.id}`} /> : null}
                        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                          <View style={{ flex: 1 }}>
                            <Button testID={`offer-${o.id}`} variant={(wins.get(o.id) ?? []).includes('best') ? 'primary' : 'secondary'} label={t('request.pick')} fullWidth onPress={() => setConfirming(o.id)} />
                          </View>
                          {/* Step 4c: ask this driver before picking him. */}
                          <TripChatEntry subject="request" id={r.id} withId={o.driverId} compact testID={`offer-chat-${o.id}`} />
                        </View>
                      </View>
                    ) : null
                  }
                >
                  {open && cash === 'accepted' ? (
                    <View style={{ gap: theme.space[2] }}>
                      <CashPanel
                        phase="accepted"
                        name={name}
                        priceIqd={o.priceIqd}
                        noShowIqd={deposit}
                        owedIqd={0}
                        asking={false}
                        askError={null}
                        booking={pick.isPending}
                        onAsk={() => undefined}
                        onBook={() => pick.mutate({ postId: r.id, offerId: o.id, cash: true }, { onSuccess: () => setConfirming(null), onError: failed })}
                      />
                      <Button variant="ghost" size="sm" label={t('action.back')} onPress={() => setConfirming(null)} />
                    </View>
                  ) : open ? (
                    <Card tone="sunken" elevation={0} padding={4} testID="rajaa-deposit">
                      <View style={{ gap: theme.space[3] }}>
                        {cash !== 'none' ? (
                          <CashPanel
                            phase={cash}
                            name={name}
                            priceIqd={o.priceIqd}
                            noShowIqd={deposit}
                            owedIqd={walletIqd !== null && walletIqd < 0 ? -walletIqd : 0}
                            asking={askCash.isPending}
                            askError={askCash.isError && askCash.variables?.offerId === o.id ? apiErrorMessage(askCash.error, t('error.network'), locale) : null}
                            booking={false}
                            onAsk={() => askCash.mutate({ postId: r.id, offerId: o.id })}
                            onBook={() => undefined}
                          />
                        ) : null}
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
                            // 4b: when the wallet can't hold it, the deposit stays possible (after a top-up) but isn't the lead.
                            variant={cash === 'none' ? 'primary' : 'secondary'}
                            label={t('rajaa.deposit_confirm')}
                            loading={pick.isPending}
                            onPress={() =>
                              pick.mutate(
                                { postId: r.id, offerId: o.id },
                                { onSuccess: () => setConfirming(null), onError: failed },
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
  // k1–k4 «جيب واحد»: who is fetched, and where to.
  const me = useMe();
  const household = useHousehold();
  const fetchChoices = useMemo(() => fetchOptions(me.data?.trustedContacts, household.data), [me.data, household.data]);
  const [fetchChip, setFetchChip] = useState<string | null>(null);
  const [fetchName, setFetchName] = useState('');
  const [fetchPhone, setFetchPhone] = useState('');
  const [fetchErrors, setFetchErrors] = useState<TypedRiderError[]>([]);
  const [fetchDrop, setFetchDrop] = useState<FetchDrop>('home');
  const fetching = trip === 'fetch';

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
  // p1: a place picked from (or typed as) a chip has a usual range once enough trips finished — where
  // the trip goes, or for «جيب واحد» where the car fetches from (`requestKnownPlace`).
  const placeLabel = (id: string) => t(`rajaa.req_place.${id}` as MessageKey);
  const fromPlaceId = fetching ? placeIdFor(from, placeLabel) : null;
  const toLabel = fetching && fetchDrop === 'home' ? t('rajaa.req_fetch_home_label') : to.trim();
  const toPlaceId = fetching && fetchDrop === 'home' ? null : placeIdFor(to, placeLabel);
  const range = useUsualRange(privateCar ? (fetching ? fromPlaceId : toPlaceId) : null, trip);
  const who = fetching ? fetchPick(fetchChip, fetchChoices, fetchName, fetchPhone) : null;
  const whoReady = !fetching || (who !== null && 'pick' in who) || fetchChip === FETCH_TYPED;
  const ready = from.trim().length > 0 && toLabel.length > 0 && whoReady && hourOk && requestDetailsProblem(details, when) === null;

  const submit = () => {
    if (!ready) {
      toast.show({ message: t(fetching ? 'rajaa.req_fetch_missing' : 'rajaa.req_missing'), tone: 'warning' });
      return;
    }
    if (who && 'errors' in who) {
      theme.haptic('error');
      setFetchErrors(who.errors);
      return;
    }
    post.mutate(
      {
        from: { label: from.trim(), ...(fromPlaceId ? { placeId: fromPlaceId } : {}) },
        to: { label: toLabel, ...(toPlaceId ? { placeId: toPlaceId } : {}) },
        when,
        seats,
        privateCar,
        // Ali dropped «منو مسافر؟» (2026-10-07); see RIDER_TRAVELLING_AS.
        travellingAs: RIDER_TRAVELLING_AS,
        ...(note.trim() ? { note: note.trim() } : {}),
        details,
        ...(who && 'pick' in who ? { rider: fetchRiderInput(who.pick) } : {}),
      },
      {
        onSuccess: () => {
          setComposing(false);
          setFrom('');
          setTo('');
          setNote('');
          setFetchChip(null);
          setFetchName('');
          setFetchPhone('');
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
          {/* y1 + k1: one way, there and back with the driver waiting, back another day, or «جيب واحد». */}
          <Section title={t('rajaa.req_trip_q')}>
            <TripKindCards kinds={TRIPS} value={trip} onChange={setTrip} />
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
          </Section>

          {fetching ? (
            <Section title={t('rajaa.req_fetch_who_q')} testID="req-fetch">
              <FetchWho
                options={fetchChoices}
                chip={fetchChip}
                onChip={(id) => {
                  setFetchChip(id);
                  setFetchErrors([]);
                }}
                name={fetchName}
                onName={(v) => {
                  setFetchName(v);
                  setFetchErrors((e) => e.filter((x) => x !== 'name'));
                }}
                phone={fetchPhone}
                onPhone={(v) => {
                  setFetchPhone(v);
                  setFetchErrors((e) => e.filter((x) => x !== 'phone'));
                }}
                errors={fetchErrors}
              />
              {/* His people are a shortcut: if they can't be read, say so (with retry); «شخص ثاني» still works. */}
              {me.isError ? (
                <QueryBoundary query={me} size="inline" skeleton={null} testID="req-fetch-me-read">
                  {() => null}
                </QueryBoundary>
              ) : null}
              {household.isError ? (
                <QueryBoundary query={household} size="inline" skeleton={null} testID="req-fetch-household-read">
                  {() => null}
                </QueryBoundary>
              ) : null}
            </Section>
          ) : null}

          {fetching ? (
            <View style={{ gap: theme.space[3] }} testID="req-fetch-places">
              {/* k2: where the person is now; the known places are one tap. */}
              <TextField testID="rajaa-req-from" label={t('rajaa.req_fetch_where_q')} placeholder={t('rajaa.req_fetch_where_placeholder')} value={from} onChangeText={setFrom} maxLength={120} leadingIcon="map-pin" />
              <View accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.req_fetch_where_q')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {REQUEST_PLACES.map((p) => {
                  const label = placeLabel(p.id);
                  return <Chip key={p.id} testID={`req-fetch-from-${p.id}`} role="radio" icon={p.icon} label={label} selected={from === label} onPress={() => setFrom(label)} />;
                })}
              </View>
              {/* k4: home in Aziziyah, or anywhere else (Baghdad airport → Kut hospital). */}
              <Text variant="label" weight={600}>
                {t('rajaa.req_fetch_to_q')}
              </Text>
              <SegmentedControl
                testIDPrefix="req-fetch-drop"
                accessibilityLabel={t('rajaa.req_fetch_to_q')}
                options={[
                  { value: 'home', label: t('rajaa.req_fetch_to_home') },
                  { value: 'other', label: t('rajaa.req_fetch_to_other') },
                ]}
                value={fetchDrop}
                onChange={(v) => setFetchDrop(v as FetchDrop)}
              />
              {fetchDrop === 'other' ? (
                <>
                  <TextField testID="rajaa-req-to" label={t('rajaa.req_to')} placeholder={t('rajaa.req_fetch_to_placeholder')} value={to} onChangeText={setTo} maxLength={120} leadingIcon="location-arrow" />
                  <View accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.req_places_a11y')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                    {REQUEST_PLACES.map((p) => {
                      const label = placeLabel(p.id);
                      return <Chip key={p.id} testID={`req-place-${p.id}`} role="radio" icon={p.icon} label={label} selected={to === label} onPress={() => setTo(label)} />;
                    })}
                  </View>
                </>
              ) : null}
            </View>
          ) : (
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
          )}
          {/* A hint, not a step: if the read fails the line is left out (the offers show the range again). */}
          {range.data && !range.isError ? <UsualRangeLine range={range.data} testID="rajaa-form-usual-range" /> : null}

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
