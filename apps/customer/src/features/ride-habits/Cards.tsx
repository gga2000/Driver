import { router } from 'expo-router';
import { View } from 'react-native';
import type { DinnerChance, FavouriteDriverView, Order, RegularTripView } from '@driver/contracts';
import { formatClock, formatWhen } from '@driver/i18n';
import { Avatar, Button, Card, Icon, Text, useTheme, useToast } from '@driver/ui';
import { routeLabel } from '@/features/rajaa/labels';
import { useRideMemo } from '@/features/ride/store';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { profile } from '@/lib/profile';
import { dinnerStore, useDinnerPick } from './dinner-store';
import { corridorCity, daysLabel, timeAt } from './logic';
import { useRecentGoodDriver, useSetFavourite } from './queries';

/** A driver's face: his approved photo, else his initial (the person glyph when he has no name). */
export function DriverFace({ name, photoUrl, size = 48, testID }: { name: string | null; photoUrl: string | null; size?: number; testID?: string }) {
  const uri = apiPhoto(photoUrl);
  return (
    <View testID={testID}>
      <Avatar {...(name ? { name } : { icon: 'user' as const })} {...(uri ? { uri } : {})} size={size} />
    </View>
  );
}

/** «البيت ← الدائرة» or «العزيزية ← الكوت». */
export function regularRoute(t: TFn, trip: Pick<RegularTripView, 'plan'>): string {
  const p = trip.plan;
  return p.kind === 'ride' ? t('rajaa.route', { from: p.pickup.label, to: p.dropoff.label }) : routeLabel(t, corridorCity(p.corridorId), p.direction);
}

/** «الأحد–الخميس · 7:30 ص». */
export function regularWhen(t: TFn, trip: Pick<RegularTripView, 'days' | 'timeMin'>, now: Date): string {
  const d = daysLabel(trip.days);
  const days =
    d.kind === 'every'
      ? t('habits.days_every')
      : d.kind === 'work'
        ? t('habits.days_work')
        : d.kind === 'one'
          ? t('habits.days_one', { day: t(`time.dow_${d.dow}` as 'time.dow_0') })
          : d.dows.map((x) => t(`time.dow_${x}` as 'time.dow_0')).join('، ');
  return t('habits.when', { days, time: formatClock(timeAt(trip.timeMin, now)) });
}

/**
 * «رحلتك الثابتة باچر 7:30 ص · أكدها» (joy r5): a regular trip asking now, on the ride and الرجعة
 * tabs. One tap opens that day; nothing is booked from the card.
 */
export function RegularDueCard({ trip, now }: { trip: RegularTripView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const next = trip.next;
  if (!next) return null;
  const open = () => router.push({ pathname: '/regular/[id]', params: { id: trip.id, date: next.date } });
  return (
    <Card testID={`regular-due-${trip.id}`} padding={4} elevation={1} onPress={open} accessibilityLabel={`${t('habits.due_title', { when: formatWhen(next.at, now) })} · ${regularRoute(t, trip)}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 48, height: 48, borderRadius: theme.radius.lg, backgroundColor: theme.colors.liveTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={trip.plan.kind === 'rajaa' ? 'rajaa' : trip.plan.rideVertical === 'tuktuk' ? 'tuktuk' : 'taxi'} size={26} color="liveText" />
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="liveText" numberOfLines={1}>
            {t('habits.due_title', { when: formatWhen(next.at, now) })}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {regularRoute(t, trip)}
          </Text>
          {trip.favourite ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {t('habits.occ_fav', { name: trip.favourite.firstName ?? t('habits.fav_unnamed') })}
            </Text>
          ) : null}
        </View>
        <Button testID={`regular-due-go-${trip.id}`} label={t('habits.confirm_cta')} size="md" onPress={open} />
      </View>
    </Card>
  );
}

/**
 * «عباس وصّلك اليوم · خليه سايقك المفضل؟» (joy l9): after a ride or الرجعة he rated 4–5 today, one
 * tap makes the driver a favourite (the server checks the rating). Hidden once he is one.
 */
export function RecentDriverCard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const recent = useRecentGoodDriver();
  const set = useSetFavourite();
  const r = recent.data;
  if (!r) return null;
  const name = r.firstName ?? t('habits.fav_unnamed');
  const add = () =>
    set.mutate(
      { ...(r.orderId ? { orderId: r.orderId } : { bookingId: r.bookingId! }), on: true },
      {
        onSuccess: () => toast.show({ message: t('habits.fav_added', { name }), tone: 'success', icon: 'heart' }),
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );
  return (
    <Card testID="recent-driver" padding={4} elevation={1}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <DriverFace name={r.firstName} photoUrl={r.photoUrl} size={52} />
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {t(r.kind === 'intercity' ? 'habits.recent_title_rajaa' : 'habits.recent_title', { name })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('habits.recent_body', { stars: r.stars })}
            </Text>
          </View>
        </View>
        <Button testID="recent-driver-add" variant="secondary" icon="heart" label={t('habits.fav_add')} loading={set.isPending} fullWidth onPress={add} />
      </View>
    </Card>
  );
}

/**
 * The heart on a finished ride or الرجعة trip rated 4–5 (joy l9): «سايقي المفضل», or, once he is,
 * «سايقك المفضل» with the way back. The server checks the rating and the owner.
 */
export function FavouriteToggle({ source, driverId, favourites, name }: { source: { orderId: string } | { bookingId: string }; driverId: string; favourites: readonly FavouriteDriverView[]; name: string | null }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const set = useSetFavourite();
  const on = favourites.some((f) => f.driverId === driverId);
  const who = name ?? t('habits.fav_unnamed');
  const flip = () =>
    set.mutate(
      { ...source, on: !on },
      {
        onSuccess: () => toast.show({ message: on ? t('habits.fav_removed', { name: who }) : t('habits.fav_added', { name: who }), tone: on ? 'neutral' : 'success', icon: 'heart' }),
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );
  return (
    <Button
      testID="favourite-toggle"
      variant={on ? 'ghost' : 'secondary'}
      icon={on ? 'check' : 'heart'}
      label={on ? t('habits.fav_is', { name: who }) : t('habits.fav_add')}
      accessibilityHint={on ? t('habits.fav_remove') : undefined}
      loading={set.isPending}
      fullWidth
      onPress={flip}
    />
  );
}

/**
 * «عشاك يوصل وياك» (joy r6): while the ride home (or a الرجعة to Aziziyah) is on, dinner from any
 * open kitchen timed by the server to reach the door when he does. The card remembers the trip and
 * opens the kitchens; checkout offers «وياك» as the time. Nothing is ordered from here.
 */
export function DinnerCard({ chance, now, testID = 'dinner-card' }: { chance: DinnerChance; now: Date; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const go = () => {
    dinnerStore.choose(chance);
    // The food goes where he is going: that saved place becomes the deliver-to.
    if (profile.getSnapshot().places.some((p) => p.id === chance.place.placeId)) void profile.selectPlace(chance.place.placeId);
    router.push('/restaurants');
  };
  return (
    <Card testID={testID} padding={4} elevation={1} tone="tint">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 48, height: 48, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="food" size={26} color="accentText" />
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="title" accessibilityRole="header">
              {t('dinner.title')}
            </Text>
            <Text variant="footnote" color="textMuted" testID={`${testID}-body`}>
              {t('dinner.body', { place: chance.place.name, time: formatWhen(chance.arriveAt, now) })}
            </Text>
          </View>
        </View>
        <Button testID={`${testID}-go`} label={t('dinner.cta')} icon="food" fullWidth onPress={go} />
      </View>
    </Card>
  );
}

/** While dinner for the ride home is being chosen (joy r6): what checkout will do, and the way out. */
export function DinnerBanner() {
  const theme = useTheme();
  const t = useT();
  const pick = useDinnerPick();
  if (!pick) return null;
  return (
    <Card testID="dinner-banner" padding={3} elevation={0} tone="tint">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Icon name="food" size={22} color="accentText" />
        <Text variant="footnote" weight={600} style={{ flex: 1 }}>
          {t('dinner.banner', { place: pick.placeName })}
        </Text>
        <Button testID="dinner-banner-close" variant="ghost" size="md" label={t('dinner.banner_close')} onPress={() => dinnerStore.clear()} />
      </View>
    </Card>
  );
}

/**
 * «مشوارك المحجوز» on home (joy J7d): the soonest ride booked for later, until its search starts —
 * then it becomes the ordinary "in progress" pill.
 */
export function BookedRideCard({ order, now }: { order: Order; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const memo = useRideMemo(order.id);
  if (!order.scheduledFor) return null;
  const when = t('habits.booked_home', { when: formatWhen(order.scheduledFor, now) });
  const open = () => router.push({ pathname: '/ride/booked/[id]', params: { id: order.id } });
  return (
    <Card testID="home-booked-ride" padding={3} elevation={1} onPress={open} accessibilityLabel={when}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.liveTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={memo?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi'} size={24} color="liveText" />
        </View>
        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="liveText" numberOfLines={1}>
            {when}
          </Text>
          {memo ? (
            <Text variant="bodyStrong" numberOfLines={1}>
              {t('rajaa.route', { from: memo.from, to: memo.to })}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </View>
    </Card>
  );
}
