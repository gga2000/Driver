import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { useToast } from '@driver/ui';
import { stopNameOf } from '@/features/rajaa/agree';
import { cityName } from '@/features/rajaa/labels';
import { endpoints, publicPlaceName } from '@/features/rajaa/logic';
import { currentLocation } from '@/features/rajaa/location';
import { endGarageFor, roadLine } from '@/features/rajaa/road';
import { garageName, useBoardingPass, useImHere, useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';
import { passBooking, passCard, passCardKey, passNotificationId, passPhase, passShowAt } from './content';
import { ongoingPass, type OngoingLabels } from './ongoing';
import { applyPassPush } from './push';

/**
 * Keeps the الرجعة boarding pass on the lock screen (customer audit d-8; Android only, a no-op on the
 * web and iOS). Mounted once at the root: it follows the rider's next live booking, schedules the card
 * for T−30 so it appears with the app closed, replaces it as the trip moves on (boarding, on board, on
 * the road), ends with "وصلت بالسلامة" and the fare, and answers the card's "أني بالكراج".
 *
 * The server also sends a data-only push at each boarding moment (`RajaaPassPush`): while the app's
 * JS runs (foreground or alive in the background) it re-posts the card from it at once. With the app
 * killed the card keeps its last words until a headless task handles that push — it needs
 * `expo-task-manager`, not installed yet; the iOS Live Activity needs a widget extension
 * (docs/api/rajaa-pass-push.md).
 */
export function useLockScreenPass() {
  const signedIn = useSignedIn();
  const t = useT();
  const toast = useToast();
  const now = useNow(30_000);
  const bookings = useMyBookings();
  const network = useNetwork();
  const imHere = useImHere();
  const enabled = ongoingPass.supported && signedIn;
  const booking = enabled ? passBooking(bookings.data ?? [], now) : null;
  const phase = booking ? passPhase(booking, now) : 'gone';
  const pass = useBoardingPass(booking?.id ?? '', enabled && !!booking && (phase === 'upcoming' || phase === 'boarding'));
  const posted = useRef<{ id: string; key: string } | null>(null);
  // "وصلت بالسلامة" only follows a trip this session watched live (never on a cold start hours later).
  const watched = useRef(new Set<string>());
  const arrived = useRef(new Set<string>());

  const labels = useMemo<OngoingLabels>(
    () => ({ channel: t('rajaa.lock_channel'), channelDesc: t('rajaa.lock_channel_desc'), imHereGarage: t('intercity.im_at_garage'), imHerePoint: t('rajaa.im_at_point') }),
    [t],
  );

  useEffect(() => {
    if (!enabled) return;
    const drop = () => {
      if (posted.current) void ongoingPass.dismiss(posted.current.id);
      posted.current = null;
    };
    if (!booking) return drop();
    const corridor = network.data?.corridors.find((c) => c.id === booking.departure.corridorId);
    const toCity = corridor ? cityName(t, endpoints(corridor.cityId, booking.departure.direction).to) : '';
    const stopName = stopNameOf(booking.pickup, garageName(network.data, booking.departure.garageId), { pin: t('rajaa.agree_pin_title'), door: t('rajaa.pickup_door'), place: publicPlaceName });
    // r6: «توصل حوالي 9:28» under «بالطريق لـ بغداد», from where the car is (the same line as the pass).
    const startG = network.data?.garages.find((g) => g.id === booking.departure.garageId) ?? null;
    const endG = corridor ? endGarageFor(network.data?.garages ?? [], endpoints(corridor.cityId, booking.departure.direction).to) : null;
    const arriveAt =
      corridor && startG && endG
        ? roadLine({
            start: { id: 'start', kind: 'start', name: '', lat: startG.lat, lng: startG.lng },
            end: { id: 'end', kind: 'end', name: '', lat: endG.lat, lng: endG.lng },
            between: [],
            departAt: booking.departure.departAt,
            departedAt: booking.departure.departedAt,
            travelMin: corridor.travelMin,
            car: booking.departure.state === 'departed' ? (pass.data?.car ?? null) : null,
            now,
          }).arriveAt
        : null;
    const input = { booking, pass: pass.data ?? null, stopName, toCity, amount: (n: number) => amountParam(n), arriveAt, now };
    if (phase === 'none') {
      // Before T−30: the card is scheduled to appear by itself at T−30.
      const at = passShowAt(booking);
      const card = passCard({ ...input, now: at }, t);
      const key = `scheduled|${passCardKey(card)}`;
      if (card && posted.current?.key !== key) {
        if (posted.current && posted.current.id !== card.id) void ongoingPass.dismiss(posted.current.id);
        void ongoingPass.schedule(card, at, labels);
        posted.current = { id: card.id, key };
      }
      return;
    }
    if (phase === 'arrived') {
      // Shown once: a dismissible "وصلت بالسلامة" is not re-posted after he swipes it away.
      if (arrived.current.has(booking.id)) return;
      if (!watched.current.has(booking.id)) return drop();
      arrived.current.add(booking.id);
    }
    const card = passCard(input, t);
    if (!card) return drop();
    if (card.sticky) watched.current.add(booking.id);
    const key = passCardKey(card);
    if (posted.current?.key === key) return;
    if (posted.current && posted.current.id !== card.id) void ongoingPass.dismiss(posted.current.id);
    void ongoingPass.show(card, labels);
    posted.current = { id: card.id, key };
  }, [enabled, booking, phase, pass.data, network.data, now, t, labels]);

  // The server's pass update (a data-only push): re-post the card from it, newest first.
  const pushedAt = useRef(new Map<string, number>());
  useEffect(() => {
    if (!enabled) return;
    return ongoingPass.onPassPush((push) => {
      void applyPassPush(push, { t, amount: (n) => amountParam(n), labels, device: ongoingPass, now: new Date(), lastSentAt: pushedAt.current }).then((key) => {
        if (key === null) return;
        if (key === '') {
          if (posted.current?.id === passNotificationId(push.bookingId)) posted.current = null;
          return;
        }
        posted.current = { id: passNotificationId(push.bookingId), key };
        if (push.phase !== 'arrived') watched.current.add(push.bookingId);
        else arrived.current.add(push.bookingId);
      });
    });
  }, [enabled, t, labels]);

  // "أني بالكراج" from the lock screen: the app opens on the pass and pings with his position.
  useEffect(() => {
    if (!enabled) return;
    return ongoingPass.onImHere((bookingId) => {
      router.push(`/rajaa/pass/${bookingId}` as never);
      void (async () => {
        const at = await currentLocation();
        if (!at) {
          toast.show({ message: t('error.location_off'), tone: 'warning', icon: 'location-arrow' }, 5000);
          return;
        }
        imHere.mutate(
          { bookingId, lat: at.lat, lng: at.lng },
          { onSuccess: (r) => toast.show({ message: r.atGarage ? t('rajaa.im_here_ok') : t('rajaa.im_here_far'), tone: r.atGarage ? 'success' : 'warning' }, 5000) },
        );
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { booking, phase, notificationId: booking ? passNotificationId(booking.id) : null };
}

/** Root mount point; renders nothing. Mounted only where the device supports the card (Android). */
export function LockScreenPass(): null {
  useLockScreenPass();
  return null;
}

/** Whether to mount `LockScreenPass` at all (no polling on the web or iOS). */
export const lockScreenPassSupported = ongoingPass.supported;
