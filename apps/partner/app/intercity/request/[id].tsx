import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { offerNeedsWaitTerms, pricierThanUsual, REQUEST_WAIT_HOURS_MAX, waitExtraIqd, type DriverRequestRide, type OfferCashState, type RequestPostView } from '@driver/contracts';
import { Button, Card, Chip, EmptyState, Icon, IconButton, Rule, Skeleton, StatusPill, Text, useTheme, useToast, WaitClock } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { RequestChatEntry } from '@/features/chat/TripChatEntry';
import { SosControl } from '@/features/safety/SosControl';
import { countedKey, requestDetailLabels, rideState, seatsCount, timeWithPeriod, travellingAsLabel, whenLabel } from '@/features/intercity/labels';
import { clampOffer, depositFor, OFFER_STEP_IQD, privateRideNet, stepExtraHour, suggestedOffer } from '@/features/intercity/logic';
import { useMyRides, useOpenRequests, useRequestActions } from '@/features/intercity/queries';
import { useNow } from '@/features/intercity/useNow';
import { useRunCall } from '@/features/intercity/useRunCall';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { amountParam } from '@/lib/money';

/**
 * A request-board post (another destination, a private car, or a stranded rider at her seat price):
 * the trip, and his offer in steps of 1,000 with the money spelled out (deposit from the rider's
 * wallet, the cash part, what he keeps after 8 %). Once the rider picks him it becomes his ride:
 * "وصلت" → "وصّلت الراكب", or "الراكب ما إجا" when the wait has passed (the deposit is his).
 */
export default function RequestScreen() {
  const theme = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const open = useOpenRequests();
  const rides = useMyRides();
  const ride = rides.data?.find((r) => r.id === id) ?? null;
  const post = open.data?.find((r) => r.id === id) ?? null;

  if (ride) return <RideView ride={ride} />;
  if (post) return <OfferView post={post} />;
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.ic_req_title') }} />
      {open.isFetched && rides.isFetched ? (
        <EmptyState icon="map-pin" title={t('partner.ic_req_gone')} action={{ label: t('partner.ic_back_board'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/intercity')) }} />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Skeleton height={140} radius={20} />
          <Skeleton height={200} radius={20} />
        </View>
      )}
    </Screen>
  );
}

function TripCard({ post, extra }: { post: RequestPostView; extra?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const now = useNow(30_000);
  return (
    <Card padding={5} testID="request-trip">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <View style={{ alignItems: 'center', paddingTop: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: theme.colors.text }} />
            <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: theme.colors.border, marginVertical: 3 }} />
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: theme.colors.accent }} />
          </View>
          <View style={{ flex: 1, gap: theme.space[3] }}>
            <Text variant="bodyStrong">{post.from.label}</Text>
            <Text variant="bodyStrong">{post.to.label}</Text>
          </View>
        </View>
        <Rule />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <StatusPill label={whenLabel(t, post.when, now)} tone="neutral" icon="clock" size="sm" />
          <StatusPill label={seatsCount(t, post.seats)} tone="neutral" icon="seat" size="sm" />
          {/* As on the garage board: «رجال» is the usual case and says nothing; women or a family is worth a pill. */}
          {post.travellingAs !== 'rijal' ? <StatusPill label={t('partner.ic_req_travelling', { as: travellingAsLabel(t, post.travellingAs) })} tone="neutral" icon="user" size="sm" /> : null}
          {post.privateCar ? <StatusPill label={t('partner.ic_req_private')} tone="info" icon="car" size="sm" /> : null}
          {post.origin === 'stranded' ? <StatusPill label={t('partner.ic_req_stranded')} tone="warning" size="sm" /> : null}
          {/* y1: what the rider asked for, so the offer prices the real trip. */}
          {requestDetailLabels(t, post.details, post.when).map((label) => (
            <StatusPill key={label} label={label} tone="accent" size="sm" />
          ))}
        </View>
        {post.note ? (
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3], gap: 2 }}>
            <Text variant="caption" color="textMuted">
              {t('partner.ic_req_note')}
            </Text>
            <Text variant="footnote">{post.note}</Text>
          </View>
        ) : null}
        {extra}
      </View>
    </Card>
  );
}

function OfferView({ post }: { post: RequestPostView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { offer, seen, answerCash } = useRequestActions();
  const mine = post.offers.find((o) => o.state === 'open') ?? null;
  // y4: opening a request tells the rider one more driver saw it (once per driver; the server dedupes).
  const markSeen = seen.mutate;
  useEffect(() => {
    markSeen({ postId: post.id });
  }, [post.id, markSeen]);
  const [price, setPrice] = useState(() => mine?.priceIqd ?? suggestedOffer(post));
  // w1: on a «يستناك وترجع» trip he says the hours his price includes and each extra hour's price.
  const needsWait = offerNeedsWaitTerms(post.details);
  const [included, setIncluded] = useState(() => mine?.wait?.includedHours ?? post.details.waitHours ?? 1);
  const [extraHour, setExtraHour] = useState<number | null>(() => mine?.wait?.extraHourIqd ?? null);
  useEffect(() => {
    if (!mine) return;
    setPrice(mine.priceIqd);
    if (mine.wait) {
      setIncluded(mine.wait.includedHours);
      setExtraHour(mine.wait.extraHourIqd);
    }
  }, [mine]);
  const waitReady = !needsWait || extraHour !== null;
  const pricier = pricierThanUsual(price, post.usualRange);
  const cap = post.priceCapIqd;
  const deposit = depositFor(price);
  const quick = [price - 5_000, price + 5_000].map((p) => clampOffer(p, cap)).filter((p, i, a) => p !== price && a.indexOf(p) === i);

  const send = async () => {
    try {
      await offer.mutateAsync({ postId: post.id, priceIqd: price, ...(needsWait && extraHour !== null ? { wait: { includedHours: included, extraHourIqd: extraHour } } : {}) });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_req_sent'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const answer = async (accept: boolean) => {
    if (!mine) return;
    try {
      await answerCash.mutateAsync({ postId: post.id, offerId: mine.id, accept });
      theme.haptic(accept ? 'success' : 'selection');
      toast.show({ message: t('partner.ic_cash_sent'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const same = mine?.priceIqd === price && (!needsWait || (mine.wait?.includedHours === included && mine.wait.extraHourIqd === extraHour));
  return (
    <Screen
      testID="request-offer"
      edges={['bottom']}
      footer={
        <Button
          testID="offer-send"
          label={mine ? (same ? t('partner.ic_req_waiting', { amount: amountParam(price) }) : t('partner.ic_req_update', { amount: amountParam(price) })) : t('partner.ic_req_send', { amount: amountParam(price) })}
          size="lg"
          fullWidth
          disabled={same || !waitReady}
          loading={offer.isPending}
          onPress={() => void send()}
        />
      }
    >
      <Stack.Screen options={{ title: t('partner.ic_req_title') }} />
      <TripCard post={post} />
      {mine?.cash ? <CashAsk cash={mine.cash} priceIqd={mine.priceIqd} busy={answerCash.isPending ? (answerCash.variables?.accept ?? null) : undefined} onAnswer={(a) => void answer(a)} /> : null}
      {/* Step 4c: the rider can ask him before picking; he answers here. */}
      {mine ? <RequestChatEntry id={post.id} /> : null}

      <Card padding={5} testID="offer-price">
        <View style={{ gap: theme.space[4] }}>
          <Text variant="label" color="textMuted">
            {t('partner.ic_req_your_price')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <IconButton icon="minus" variant="tonal" size={52} accessibilityLabel="−1,000" onPress={() => setPrice((p) => clampOffer(p - OFFER_STEP_IQD, cap))} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="display" tabular testID="offer-amount">
                {amountParam(price)}
              </Text>
              <Text variant="label" color="textMuted">
                {t('quote.currency')}
              </Text>
            </View>
            <IconButton icon="plus" variant="tonal" size={52} accessibilityLabel="+1,000" onPress={() => setPrice((p) => clampOffer(p + OFFER_STEP_IQD, cap))} />
          </View>
          {quick.length > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2] }}>
              {quick.map((p) => (
                <Chip key={p} role="button" label={amountParam(p)} onPress={() => setPrice(p)} />
              ))}
            </View>
          ) : null}
          {cap !== null ? (
            <Text variant="footnote" color="warningText" align="center" tabular>
              {t('partner.ic_req_cap_note', { amount: amountParam(cap) })}
            </Text>
          ) : null}
          {/* p2/p3: the same usual range the rider sees, and a soft word when he is well above it. */}
          {post.usualRange ? (
            <View testID="offer-usual-range" style={{ alignItems: 'center', gap: 2 }}>
              <Text variant="label" weight={600} align="center" tabular>
                {t('rajaa.usual_range', { low: amountParam(post.usualRange.lowIqd), high: amountParam(post.usualRange.highIqd) })}
              </Text>
              <Text variant="caption" color="textMuted" align="center">
                {t(countedKey('rajaa.usual_range_from', post.usualRange.trips), { n: post.usualRange.trips })}
              </Text>
              {pricier ? (
                <Text testID="offer-pricier" variant="footnote" color="warningText" align="center">
                  {t('partner.ic_req_pricier')}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Rule />
          <View style={{ gap: theme.space[2] }}>
            <MoneyLine
              icon="wallet"
              text={mine?.cash === 'accepted' ? t('partner.ic_cash_accepted', { price: amountParam(price) }) : t('partner.ic_req_deposit_note', { deposit: amountParam(deposit), cash: amountParam(price - deposit) })}
            />
            <MoneyLine icon="receipt" text={t('partner.ic_req_net', { net: amountParam(privateRideNet(price)) })} strong />
          </View>
        </View>
      </Card>

      {needsWait ? (
        <Card padding={5} testID="offer-wait">
          <View style={{ gap: theme.space[4] }}>
            <View style={{ gap: theme.space[1] }}>
              <Text variant="bodyStrong">{t('partner.ic_req_wait_title')}</Text>
              <Text variant="footnote" color="textMuted">
                {t('partner.ic_req_wait_hint', { hours: t(countedKey('rajaa.req_hours', post.details.waitHours ?? 1), { n: post.details.waitHours ?? 1 }) })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {t('partner.ic_req_wait_included')}
              </Text>
              <IconButton icon="minus" variant="tonal" size={44} accessibilityLabel="−1" disabled={included === 0} onPress={() => setIncluded((h) => Math.max(0, h - 1))} />
              <Text testID="offer-wait-hours" variant="label" weight={700} tabular align="center" style={{ minWidth: 76 }}>
                {t(countedKey('rajaa.req_hours', included), { n: included })}
              </Text>
              <IconButton icon="plus" variant="tonal" size={44} accessibilityLabel="+1" disabled={included === REQUEST_WAIT_HOURS_MAX} onPress={() => setIncluded((h) => Math.min(REQUEST_WAIT_HOURS_MAX, h + 1))} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {t('partner.ic_req_extra_hour')}
              </Text>
              <IconButton icon="minus" variant="tonal" size={44} accessibilityLabel="−1,000" disabled={extraHour === 0} onPress={() => setExtraHour((v) => stepExtraHour(v, -1))} />
              <Text testID="offer-extra-hour" variant="label" weight={700} tabular align="center" color={extraHour === null ? 'accentText' : 'text'} style={{ minWidth: 76 }}>
                {extraHour === null ? t('partner.ic_req_extra_unset') : extraHour === 0 ? t('partner.ic_req_extra_free') : `${amountParam(extraHour)} ${t('quote.currency')}`}
              </Text>
              <IconButton icon="plus" variant="tonal" size={44} accessibilityLabel="+1,000" onPress={() => setExtraHour((v) => stepExtraHour(v, 1))} />
            </View>
            {extraHour === null ? (
              <Text variant="footnote" color="warningText" testID="offer-wait-missing">
                {t('partner.ic_req_wait_missing')}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function MoneyLine({ icon, text, strong = false }: { icon: 'wallet' | 'receipt'; text: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
      <Icon name={icon} size={16} color="textMuted" style={{ marginTop: 3 }} />
      <Text variant="footnote" weight={strong ? 600 : 400} color={strong ? 'text' : 'textMuted'} style={{ flex: 1 }} tabular>
        {text}
      </Text>
    </View>
  );
}

/**
 * Step 4b a6: a rider asked to book and pay all of it in cash (no deposit). He answers once; the
 * no-show amount (the deposit) is said before he does.
 */
function CashAsk({ cash, priceIqd, busy, onAnswer }: { cash: OfferCashState; priceIqd: number; busy: boolean | null | undefined; onAnswer: (accept: boolean) => void }) {
  const theme = useTheme();
  const t = useT();
  const amount = amountParam(depositFor(priceIqd));
  if (cash !== 'asked')
    return (
      <View testID={`offer-cash-${cash}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: cash === 'accepted' ? theme.colors.successTint : theme.colors.surfaceSunken }}>
        <Icon name="cash" size={18} color={cash === 'accepted' ? 'successText' : 'textMuted'} strokeWidth={2} />
        <Text variant="footnote" color={cash === 'accepted' ? 'successText' : 'textMuted'} style={{ flex: 1 }} tabular>
          {cash === 'accepted' ? t('partner.ic_cash_accepted_short') : t('partner.ic_cash_declined', { amount })}
        </Text>
      </View>
    );
  return (
    <Card padding={5} testID="offer-cash-ask" style={{ borderWidth: 1.5, borderColor: theme.colors.accent }}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
            <Icon name="cash" size={20} color="accentText" strokeWidth={2} />
          </View>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('partner.ic_cash_ask_title')}
          </Text>
        </View>
        <Text variant="footnote" color="textMuted" tabular>
          {t('partner.ic_cash_ask_body', { price: amountParam(priceIqd), amount })}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <View style={{ flex: 1 }}>
            <Button testID="offer-cash-yes" label={t('partner.ic_cash_yes')} icon="check" fullWidth loading={busy === true} disabled={busy !== undefined} onPress={() => onAnswer(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="offer-cash-no" label={t('partner.ic_cash_no')} variant="secondary" fullWidth loading={busy === false} disabled={busy !== undefined} onPress={() => onAnswer(false)} />
          </View>
        </View>
      </View>
    </Card>
  );
}

function RideView({ ride }: { ride: DriverRequestRide }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const now = useNow(5_000);
  const actions = useRequestActions();
  const client = useApiClient();
  const caller = useRunCall();
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  // k2 «جيب واحد»: the person at the pickup is the one fetched, not the one who booked.
  const fetchName = ride.details.trip === 'fetch' ? (ride.rider?.name ?? t('rajaa.req_trip.fetch')) : null;
  const callWho = fetchName ?? t('partner.ic_ride_call_rider');
  const call = () => void caller.call(ride.id, callWho, () => client.routes.requestBoard.callPerson.mutate({ postId: ride.id }));
  const noShowOpen = ride.riderNoShowAt !== null && ride.riderNoShowAt.getTime() <= now.getTime();
  const deposit = ride.depositIqd ?? 0;
  // w2/w4: a «يستناك وترجع» trip has a waiting clock; extra waiting (when the charge is on) is cash too.
  const waitTrip = offerNeedsWaitTerms(ride.details);
  const clock = ride.waitClock;
  const extraIqd = clock ? waitExtraIqd(clock, now) : 0;
  const fareIqd = ride.priceIqd + extraIqd;
  // 4b: on a cash reservation nothing came from the wallet; the deposit is only the no-show amount.
  // Step 6: friends who joined a shared car paid their places from their wallets; that is not cash either.
  const friendsIqd = ride.share?.friendsIqd ?? 0;
  const collectIqd = Math.max(0, fareIqd - (ride.cashReserved ? 0 : deposit) - friendsIqd);

  const arrived = async () => {
    const fix = await currentFix(5000);
    // The server records the GPS; without a fix (desktop) the pickup point itself stands in.
    const at = fix ?? (ride.from.lat !== undefined && ride.from.lng !== undefined ? { lat: ride.from.lat, lng: ride.from.lng } : null);
    if (!at) {
      toast.show({ message: t('partner.location_needed'), tone: 'warning' });
      return;
    }
    try {
      await actions.arrived.mutateAsync({ postId: ride.id, ...at });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };
  const waitStart = async () => {
    try {
      await actions.waitStart.mutateAsync({ postId: ride.id });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };
  const waitEnd = async () => {
    try {
      await actions.waitEnd.mutateAsync({ postId: ride.id });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };
  const complete = async () => {
    try {
      await actions.complete.mutateAsync({ postId: ride.id });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_ride_done', { amount: amountParam(privateRideNet(fareIqd)) }), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const noShow = async () => {
    try {
      await actions.riderNoShow.mutateAsync({ postId: ride.id });
      toast.show({ message: t('partner.ic_ride_noshow_done', { amount: amountParam(deposit) }), tone: 'neutral' });
    } catch (err) {
      fail(err);
    }
  };

  const live = ride.state === 'matched' || ride.state === 'driver_arrived';
  const footer =
    ride.state === 'matched' ? (
      <Button testID="ride-arrived" label={t('partner.ic_ride_arrived_cta')} icon="map-pin" size="lg" fullWidth loading={actions.arrived.isPending} onPress={() => void arrived()} />
    ) : ride.state === 'driver_arrived' && waitTrip && clock && !clock.endedAt ? (
      <Button testID="ride-wait-end" label={t('partner.ic_ride_wait_end_cta')} icon="check" size="lg" fullWidth loading={actions.waitEnd.isPending} onPress={() => void waitEnd()} />
    ) : ride.state === 'driver_arrived' ? (
      <View style={{ gap: theme.space[2] }}>
        {waitTrip && !clock ? (
          <Button testID="ride-wait-start" label={t('partner.ic_ride_wait_start_cta')} icon="clock" size="lg" fullWidth loading={actions.waitStart.isPending} onPress={() => void waitStart()} />
        ) : null}
        <Button
          testID="ride-complete"
          label={t('partner.ic_ride_complete_cta')}
          icon="check"
          size="lg"
          variant={waitTrip && !clock ? 'secondary' : 'primary'}
          fullWidth
          loading={actions.complete.isPending}
          onPress={() => void complete()}
        />
        <Button
          testID="ride-noshow"
          label={noShowOpen || !ride.riderNoShowAt ? t('partner.ic_ride_noshow_cta') : t('partner.ic_ride_noshow_wait', { time: timeWithPeriod(t, ride.riderNoShowAt) })}
          variant="ghost"
          disabled={!noShowOpen}
          loading={actions.riderNoShow.isPending}
          onPress={() => void noShow()}
        />
      </View>
    ) : (
      <Button label={t('partner.ic_back_board')} variant="secondary" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))} />
    );

  return (
    <Screen testID="request-ride" edges={['bottom']} footer={footer}>
      <Stack.Screen options={{ title: t('partner.ic_ride_title'), headerRight: live ? () => <SosControl subject={{ kind: 'request', id: ride.id }} style={{ marginEnd: theme.space[3] }} /> : undefined }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <StatusPill label={clock && !clock.endedAt && live ? t('rajaa.wait_title_driver') : rideState(t, ride.state)} tone={live ? 'accent' : ride.state === 'completed' ? 'success' : 'neutral'} live={live} />
      </View>
      {live ? (
        <Card padding={4} testID="ride-person">
          <View style={{ gap: theme.space[3] }}>
            {fetchName ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
                  <Icon name="user" size={20} color="accentText" strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" testID="ride-fetch-for">
                    {t('partner.ic_req_fetch_for', { name: fetchName })}
                  </Text>
                  <Text variant="footnote" color="textMuted">
                    {t('partner.ic_req_fetch_note')}
                  </Text>
                </View>
              </View>
            ) : null}
            <Button
              testID="ride-call"
              variant="secondary"
              icon="phone"
              fullWidth
              label={fetchName ? t('partner.ic_ride_call_person', { name: fetchName }) : t('partner.ic_ride_call_rider')}
              loading={caller.busyKey === ride.id}
              onPress={call}
            />
            <RequestChatEntry id={ride.id} testID="ride-chat" />
          </View>
        </Card>
      ) : null}
      <TripCard post={ride} />
      {clock ? <WaitClock clock={clock} now={now} side="driver" locale={locale} testID="ride-wait-clock" /> : null}
      <Card padding={5} testID="ride-money">
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="amount" tabular>
              {amountParam(fareIqd)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('quote.currency')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <Icon name="wallet" size={20} color="accentText" />
            <Text variant="label" weight={700} color="accentText" style={{ flex: 1 }} tabular>
              {t('partner.ic_ride_collect', { amount: amountParam(collectIqd) })}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted" tabular>
            {[
              ride.cashReserved ? t('partner.ic_ride_cash_reserved', { amount: amountParam(deposit) }) : t('partner.ic_ride_deposit', { amount: amountParam(deposit) }),
              ...(friendsIqd > 0 ? [t('partner.ic_ride_shared', { amount: amountParam(friendsIqd) })] : []),
              t('partner.ic_req_net', { net: amountParam(privateRideNet(fareIqd)) }),
            ].join(' · ')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
