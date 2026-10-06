import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { RAJAA_GOOD_TAGS, RAJAA_LOW_STARS, RAJAA_LOW_TAGS, type BookingView, type RajaaRatingTag } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Chip, Icon, SketchScene, Text, useTheme, useToast } from '@driver/ui';
import { useMe } from '@/features/account/queries';
import { useSupportWhatsApp } from '@/features/help/HelpParts';
import { dayKey } from '@/features/orders/history';
import { dayLabel } from '@/features/orders/OrderRow';
import { Stars } from '@/features/track/Arrival';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { seatsList } from './labels';
import { clockLabel } from './logic';
import { useRateBooking } from './queries';
import { returnTrip } from './return-trip';

/**
 * «وصلت بالسلامة» (joy r2, audit R-04, S-2): the ending a الرجعة trip never had. The arrival drawing,
 * «الحمد لله على السلامة», the route and when it arrived, who we told (the safety page's people, when
 * «بلّغهم من أوصل» is on), the points that came in, the driver's rating with chips (and «عندي مشكلة»),
 * then «احجز رجعتك» (the reverse direction, same weekday and time) and a tuktuk home from the garage.
 */
export function SafeArrival({ booking, route, driverName, now }: { booking: BookingView; route: string; driverName: string | null; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const rate = useRateBooking();
  const support = useSupportWhatsApp();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<RajaaRatingTag[]>([]);
  const arrivedAt = booking.completedAt ?? booking.departure.departAt;
  const told = me.data?.safety.notifyOnArrival ? (me.data.trustedContacts ?? []).map((c) => c.name) : [];
  const back = returnTrip(booking, now);
  const homeIsAziziyah = booking.departure.direction === 'to_aziziyah';
  const rated = booking.rating;
  const low = stars > 0 && stars <= RAJAA_LOW_STARS;
  const chips = low ? RAJAA_LOW_TAGS : RAJAA_GOOD_TAGS;

  const send = () =>
    rate.mutate(
      { bookingId: booking.id, stars, tags: tags.filter((x) => chips.includes(x)) },
      { onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger', placement: 'top' }) },
    );
  const problem = () =>
    void support(
      t('rajaa.safe_problem_message', { route, day: dayLabel(t, dayKey(booking.departure.departAt, now)), time: clockLabel(booking.departure.departAt), seat: seatsList(t, booking.seatIds) }),
    );

  return (
    <Card padding={0} elevation={2} testID="rajaa-safe-arrival">
      <SketchScene name="safe_arrival" vehicle="minibus" style={{ width: '100%', aspectRatio: 1.6 }} />
      <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
        <View style={{ gap: theme.space[1], alignItems: 'center' }}>
          <Text variant="heading" face="voice" align="center" accessibilityRole="header">
            {t('rajaa.safe_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('rajaa.safe_route_time', { route, time: clockLabel(arrivedAt) })}
          </Text>
        </View>

        {told.length > 0 ? (
          <View testID="rajaa-safe-told" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], justifyContent: 'center' }}>
            <Icon name="check" size={16} color="successText" strokeWidth={2.4} />
            <Text variant="footnote" color="successText" weight={600}>
              {t('rajaa.safe_told', { names: told.join('، ') })}
            </Text>
          </View>
        ) : null}

        {booking.pointsEarned ? (
          <View
            testID="rajaa-safe-points"
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], alignSelf: 'center', paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.deal }}
          >
            <Icon name="star" size={16} color="onDeal" filled fillColor="onDeal" />
            <Text variant="label" weight={700} color="onDeal" tabular>
              {t('rajaa.safe_points', { n: amountParam(booking.pointsEarned) })}
            </Text>
          </View>
        ) : null}

        {/* The driver's rating: stars, then what went well (or, at 3★ or less, what didn't). */}
        <View style={{ gap: theme.space[3], paddingTop: theme.space[2], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          {rated ? (
            <View testID="rajaa-safe-rated" style={{ alignItems: 'center', gap: theme.space[2] }}>
              <Stars value={rated.stars} onPick={() => undefined} testID="rate-star-done" />
              <Text variant="label" color="textMuted">
                {t('rajaa.safe_rated')}
              </Text>
            </View>
          ) : (
            <>
              <Text variant="title" align="center">
                {driverName ? t('rajaa.safe_rate_title', { driver: driverName }) : t('rajaa.safe_rate_title_plain')}
              </Text>
              <Stars
                value={stars}
                onPick={(n) => {
                  setStars(n);
                  setTags([]);
                }}
                testID="rate-star"
              />
              {stars > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], justifyContent: 'center' }} testID="rajaa-rate-chips">
                  {chips.map((c) => (
                    <Chip
                      key={c}
                      testID={`rate-tag-${c}`}
                      role="checkbox"
                      label={t(`rajaa.rate_tag.${c}` as MessageKey)}
                      selected={tags.includes(c)}
                      onPress={() => setTags((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
                    />
                  ))}
                </View>
              ) : null}
              {stars > 0 ? <Button testID="rajaa-rate-send" label={t('rajaa.safe_rate_send')} fullWidth loading={rate.isPending} onPress={send} /> : null}
            </>
          )}
          {low || (rated && rated.stars <= RAJAA_LOW_STARS) ? (
            <Button testID="rajaa-safe-problem" variant="ghost" icon="chat" label={t('rajaa.safe_problem')} onPress={problem} />
          ) : null}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="rajaa-book-return"
            variant="secondary"
            icon="rajaa"
            fullWidth
            label={t('rajaa.safe_book_return', { when: `${dayLabel(t, dayKey(back.at, now))} ${clockLabel(back.at)}` })}
            onPress={() => router.push({ pathname: '/rajaa', params: { corridor: back.corridorId, direction: back.direction, at: back.at.toISOString() } })}
          />
          {homeIsAziziyah ? (
            <Button testID="rajaa-tuktuk-home" variant="ghost" icon="tuktuk" fullWidth label={t('rajaa.safe_tuktuk')} onPress={() => router.push({ pathname: '/ride', params: { vertical: 'tuktuk' } })} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}
