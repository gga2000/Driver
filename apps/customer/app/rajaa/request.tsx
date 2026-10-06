import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { RequestPostView, TravellingAs } from '@driver/contracts';
import { Button, Card, Chip, ChipGroup, Icon, Rule, Skeleton, StatusPill, Stepper, Text, TextField, useTheme, useToast, type StatusTone } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { requestStateLabel, seatsCount, slotLabel, TRAVELLING_AS, travellingAsLabel } from '@/features/rajaa/labels';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { clockLabel, depositFor, REQUEST_HOURS, requestHourAvailable, requestWhen, type RequestDay } from '@/features/rajaa/logic';
import { RuleList, Section } from '@/features/rajaa/Option';
import { useCancelRequest, useMyRequests, usePickOffer, usePostRequest } from '@/features/rajaa/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

const TONE: Partial<Record<RequestPostView['state'], StatusTone>> = { open: 'accent', matched: 'success', driver_arrived: 'success', driver_no_show: 'danger' };

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
  const offers = [...r.offers].filter((o) => o.state === 'open' || o.state === 'picked').sort((a, b) => a.priceIqd - b.priceIqd);
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
              {r.privateCar ? ` · ${t('request.private_car')}` : ''}
            </Text>
          </View>
          <StatusPill size="sm" tone={TONE[r.state] ?? 'neutral'} live={r.state === 'open'} label={requestStateLabel(t, r.state)} />
        </View>

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
          offers.length === 0 ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
              <Icon name="clock" size={16} color="textMuted" />
              <Text variant="footnote" color="textMuted">
                {t('rajaa.req_waiting')}
              </Text>
            </View>
          ) : (
            <View style={{ gap: theme.space[2] }}>
              {/* R-01: sorted by price and said so; every offer gets the same button (no default pick). */}
              <Text variant="caption" color="textMuted" weight={600} testID="rajaa-offers-header">
                {t('rajaa.req_offers_count', { count: offers.length })}
              </Text>
              {offers.map((o, i) => {
                const deposit = depositFor(o.priceIqd);
                const open = confirming === o.id;
                return (
                  <View key={o.id} style={{ gap: theme.space[2] }}>
                    {i > 0 ? <Rule /> : null}
                    <RajaaDriver dep={{ vehicle: o.driver?.vehicle ?? null }} card={o.driver} testID={`offer-driver-${o.id}`} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                      <Text variant="bodyStrong" tabular style={{ flex: 1 }} testID={`offer-price-${o.id}`}>
                        {iqd(o.priceIqd, { locale })}
                      </Text>
                      {!open ? <Button testID={`offer-${o.id}`} variant="secondary" label={t('request.pick')} onPress={() => setConfirming(o.id)} /> : null}
                    </View>
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
                  </View>
                );
              })}
            </View>
          )
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
  const [travellingAs, setTravellingAs] = useState<TravellingAs>('aila');
  const [note, setNote] = useState('');

  const active = (mine.data ?? []).filter((r) => r.state === 'open' || r.state === 'matched' || r.state === 'driver_arrived');
  const showForm = composing || (!mine.isPending && active.length === 0);
  const hourOk = requestHourAvailable(day, hour, now);
  const ready = from.trim().length > 0 && to.trim().length > 0 && hourOk;

  const submit = () => {
    if (!ready) {
      toast.show({ message: t('rajaa.req_missing'), tone: 'warning' });
      return;
    }
    post.mutate(
      {
        from: { label: from.trim() },
        to: { label: to.trim() },
        when: requestWhen(day, hour, now),
        seats,
        privateCar,
        travellingAs,
        ...(note.trim() ? { note: note.trim() } : {}),
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
            <TextField testID="rajaa-req-to" label={t('rajaa.req_to')} placeholder={t('rajaa.req_to_placeholder')} value={to} onChangeText={setTo} maxLength={120} leadingIcon="location-arrow" />
          </View>

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
          </Section>

          <Section title={t('intercity.travelling_as')}>
            <ChipGroup
              required
              items={TRAVELLING_AS.map((v) => ({ id: v, label: travellingAsLabel(t, v), icon: 'user' as const }))}
              value={[travellingAs]}
              onChange={(next) => setTravellingAs((next[0] as TravellingAs | undefined) ?? 'aila')}
            />
          </Section>

          <TextField label={t('rajaa.req_note')} placeholder={t('rajaa.req_note_placeholder')} value={note} onChangeText={setNote} maxLength={300} multiline />
        </View>
      ) : null}
    </Screen>
  );
}
