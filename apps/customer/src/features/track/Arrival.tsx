import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOOD_RATED_TYPES, type CourierRatingReason, type OrderTracking, type RatingTag, type VehicleClass } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, ChipGroup, Icon, ltr, PhotoImage, SketchScene, Text, useCountUp, usePhotoFallback, useTheme, useToast, type SceneVehicle } from '@driver/ui';
import { useMyPlaces } from '@/features/account/queries';
import { photoUri } from '@/features/account/device';
import { apiErrorMessage } from '@/lib/api';
import { apiPhoto } from '@/lib/photo';
import { amountParam, iqd } from '@/lib/money';
import { useLocale, useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { RideArrivalSummary } from '@/features/ride/LiveParts';
import { firstKindForOrder, rideStickerFor } from '@/features/firsts/firsts';
import { RideStickerCard } from '@/features/firsts/RideStickerCard';
import { FirstMoment, useOrderFirsts } from '@/features/firsts/FirstMoment';
import { arrivalPlays, arrivalSeenKey, cashAtDoor, gatePhotoFor } from './arrival-logic';
import { rideArrivalCopy } from './arrival-copy';
import { ChangeCreditStrip } from './ChangeCredited';
import { BottomPanel } from './Panels';
import { useOpenDispute, useRateOrder } from './queries';
import { courierReasons, disputeKindFor, keepFitting, lowReasons, LOW_SCORE, ratingBranch } from './rating-logic';
import { ComplimentCard } from './Compliments';
import { DishBurst } from './DishBurst';
import { TipOffer } from './TipOffer';
import type { Phase } from './timeline';

/**
 * Joy f2 (L-04): whether this order's delivered moment plays, decided once when the screen first sees
 * it delivered — live (it happened while watching) or on opening within ten minutes of delivery — and
 * never again on this phone once played (`arrivalSeenKey`). `null` until decided.
 */
export function useArrivalOnce(view: OrderTracking | undefined, phase: Phase | null, clock: () => number): boolean | null {
  const prev = useRef<Phase | null>(null);
  const [decision, setDecision] = useState<{ orderId: string; plays: boolean } | null>(null);
  const orderId = view?.order.id ?? null;
  const deliveredAt = view ? (view.order.deliveredAt ?? view.trip?.completedAt ?? view.order.closedAt ?? null) : null;
  useEffect(() => {
    const was = prev.current;
    prev.current = phase;
    if (!orderId || phase !== 'arrived' || decision?.orderId === orderId) return;
    const liveTransition = was !== null && was !== 'arrived' && was !== 'done';
    void (async () => {
      const key = arrivalSeenKey(orderId);
      const seen = (await storage.getItem(key).catch(() => null)) !== null;
      const plays = arrivalPlays({ seen, liveTransition, deliveredAt, now: clock() });
      if (plays) await storage.setItem(key, String(clock())).catch(() => undefined);
      setDecision({ orderId, plays });
    })();
    // Decided once per order: later reads of the same delivered order change nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, phase]);
  return decision && decision.orderId === orderId ? decision.plays : null;
}

/**
 * The arrival moment (spec §4, C-11): a success haptic and a full-screen "وصل طلبك" with the gate
 * photo the customer saved for that place (no card at all when there is none — never a placeholder),
 * and the cash hand-off: the exact amount to hand the courier and, when the total was rounded up to
 * 250, the change that comes back to his wallet ("الباقي رصيد"). Then the two-tap rating.
 */
export function ArrivalOverlay({ view, onRate, onLater }: { view: OrderTracking; onRate: () => void; onLater: () => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const places = useMyPlaces();
  const ride = view.order.type === 'ride';
  // L-09: «ويا عباس · 12 دقيقة» under «وصلت بالسلامة», and «قيّم عباس» (rides rate in one step).
  const rideCopy = ride ? rideArrivalCopy(t, view) : null;
  const forName = ride ? (view.order.rider?.name ?? null) : null;
  const photo = ride ? null : gatePhotoFor(view.dropoff, places.data ?? []);
  // The saved gate photo is a signed link; if it no longer loads the card goes, like having none.
  const gate = usePhotoFallback(photo ? photoUri(photo) : null);
  const pay = cashAtDoor(view.order);
  const today = useSeason();
  // «أول مرة» (joy g8): the first meal delivered or the first tuktuk ride, once in a lifetime.
  const firsts = useOrderFirsts();
  const first = firstKindForOrder(view.order.id, firsts.data);
  // Ride idea g2: the first night ride and the 10th, 25th… ride earn a sticker from the pack. One moment
  // per arrival: on a ride that is also a «أول مرة», the first wins (the sticker stays in the pack).
  const sticker = ride && !first ? rideStickerFor(view.order.id, firsts.data) : null;
  // On a quiet day (mourning, set in the Console) the moment is calm: no burst, no bounce, no success buzz.
  const celebrate = today.celebrations && !theme.reduceMotion;
  useEffect(() => {
    if (today.celebrations) theme.haptic('success');
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      testID="arrival"
      entering={theme.reduceMotion ? undefined : FadeIn.duration(220)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(200)}
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg, paddingTop: insets.top + theme.space[8], paddingBottom: Math.max(insets.bottom, theme.space[6]), paddingHorizontal: theme.space[6] }]}
    >
      <View style={{ flex: 1, alignItems: 'center', gap: theme.space[4], width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        {/* Joy J4 (S2-12): the door scene (food) or the road home (rides) instead of a glowing check. */}
        <Animated.View
          testID="arrival-scene"
          entering={celebrate ? ZoomIn.springify().damping(16) : theme.reduceMotion ? undefined : FadeIn.duration(220)}
          style={{ width: '100%', maxWidth: photo ? ARRIVAL_SCENE_WITH_PHOTO : ride ? ARRIVAL_SCENE_RIDE : view.courier ? ARRIVAL_SCENE_WITH_COURIER : ARRIVAL_SCENE_MAX }}
        >
          {ride ? <SketchScene name="safe_arrival" vehicle={sceneVehicle(view.courier?.vehicleClass ?? null)} /> : <SketchScene name="door" />}
        </Animated.View>
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          {/* s3: the booker who followed someone else's ride reads «مشوار ماما وصل بالسلامة» (a longer line, a size down). */}
          <Text variant="display" style={forName ? { fontSize: 30, lineHeight: 44 } : { fontSize: 36, lineHeight: 52 }} accessibilityRole="header" align="center" testID="arrival-title">
            {forName ? t('track.arrived_title_ride_for', { name: forName }) : ride ? t('track.arrived_title_ride') : t('track.arrived_title_food')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {rideCopy ? rideCopy.subtitle : t('track.arrived_food', { merchant: view.merchant?.name ?? '' })}
          </Text>
          {/* «بالعافية»: tiny dishes burst out over the title, once per order (food only). */}
          {celebrate && !ride ? <DishBurst /> : null}
        </View>
        {/* Joy l4: the person in the peak — who brought it (food; a ride's subtitle already names him). */}
        {!ride && view.courier ? <ArrivedWith courier={view.courier} /> : null}
        <FirstMoment kind={first} />
        <RideStickerCard sticker={sticker} />
        {/* A ride ends wherever the rider asked, not at a door: its own fare summary instead. */}
        {ride ? (
          <RideArrivalSummary view={view} />
        ) : (
          <>
            {gate.uri ? (
              <View testID="arrival-photo" style={{ width: '100%', flexShrink: 1, gap: theme.space[1] }}>
                <PhotoImage
                  uri={gate.uri}
                  onError={gate.onError}
                  accessibilityLabel={t('track.arrived_gate')}
                  style={{ width: '100%', height: 200, maxHeight: 220, borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}
                />
                <Text variant="caption" color="textMuted" align="center">
                  {t('track.arrived_gate')}
                </Text>
              </View>
            ) : null}
            <CashAtDoor pay={pay} />
          </>
        )}
      </View>
      <View style={{ gap: theme.space[2], width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <Button label={rideCopy ? rideCopy.rate : t('track.arrived_continue')} icon="star" size="lg" fullWidth onPress={onRate} testID="arrival-rate" />
        <Button label={t('track.rate_later')} variant="ghost" fullWidth onPress={onLater} />
      </View>
    </Animated.View>
  );
}

/** «حيدر وصّلك طلبك» with his approved photo (or his initial) under the delivered title. */
function ArrivedWith({ courier }: { courier: NonNullable<OrderTracking['courier']> }) {
  const theme = useTheme();
  const t = useT();
  const name = courier.firstName ?? t('track.courier_fallback');
  return (
    <View testID="arrival-courier" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={40} />
      <Text variant="label" weight={600}>
        {t('track.arrived_courier', { name })}
      </Text>
    </View>
  );
}

/** How wide the arrival drawing grows; smaller when the customer's own gate photo also shows. */
const ARRIVAL_SCENE_MAX = 300;
const ARRIVAL_SCENE_WITH_PHOTO = 168;
/** With the courier's row under the title (joy l4): a little smaller, so the cash card still fits a 360×740 phone. */
const ARRIVAL_SCENE_WITH_COURIER = 236;
/** A ride's receipt (ride idea a1) needs the room under the drawing. */
const ARRIVAL_SCENE_RIDE = 220;

/** Which vehicle brings a rider home in the arrival drawing. */
function sceneVehicle(vehicle: VehicleClass | null): SceneVehicle {
  if (vehicle === 'tuktuk') return 'tuktuk';
  if (vehicle === 'van' || vehicle === 'intercity') return 'minibus';
  return 'car';
}

/** "جهّز 18,000 دينار للدليفري" and, when rounded, "الطلب 17,800 دينار، والـ200 الباقية ترجعلك رصيد بمحفظتك". */
function CashAtDoor({ pay }: { pay: ReturnType<typeof cashAtDoor> }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (pay.kind === 'paid') {
    return (
      <View testID="arrival-paid" style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.lg, padding: theme.space[4] }}>
        <Icon name="wallet" size={20} color="successText" strokeWidth={2.2} />
        <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
          {t('track.paid_wallet', { amount: amountParam(pay.amountIqd) })}
        </Text>
      </View>
    );
  }
  // "الخردة علينا": the courier had no change and the rest of the note is in the wallet now.
  if (pay.creditedIqd > 0) {
    return (
      <View style={{ width: '100%', gap: theme.space[3] }}>
        <ChangeCreditStrip amountIqd={pay.creditedIqd} />
        {/* The order's total first, so the credit is not a sum to work out: "الطلب 14,000 دينار · دفعت 25,000 دينار كاش". */}
        <Text variant="label" weight={600} align="center" tabular testID="arrival-paid-note">
          {t('cashchange.arrival_paid_total', { total: amountParam(pay.cashIqd), paid: amountParam(pay.paidIqd) })}
        </Text>
      </View>
    );
  }
  return (
    <View testID="arrival-cash" style={{ width: '100%', backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cash" size={24} color="accentText" strokeWidth={2} />
        </View>
        <Text variant="title" weight={700} style={{ flex: 1 }} testID="arrival-cash-amount">
          {t('track.cash_ready', { amount: amountParam(pay.cashIqd) })}
        </Text>
      </View>
      {pay.changeIqd > 0 ? (
        <View testID="arrival-change" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
          <View style={{ marginTop: 2 }}>
            <Icon name="wallet" size={16} color="successText" strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={600} color="successText">
              {`${t('quote.change_to_wallet')} ${iqd(pay.changeIqd, { locale, sign: true })}`}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('track.cash_change_note', { price: amountParam(pay.priceIqd), change: amountParam(pay.changeIqd) })}
            </Text>
          </View>
        </View>
      ) : pay.tender ? null : (
        <Text variant="footnote" color="textMuted">
          {t('track.cash_exact_note')}
        </Text>
      )}
      {pay.tender ? (
        <View testID="arrival-tender" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <View style={{ marginTop: 2 }}>
            <Icon name="cash" size={16} color="accentText" strokeWidth={2.2} />
          </View>
          <Text variant="footnote" color="text" tabular style={{ flex: 1 }}>
            {t('cashchange.door_tender', { tender: amountParam(pay.tender.tenderIqd), change: amountParam(pay.tender.changeIqd) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function Stars({ value, onPick, testID }: { value: number; onPick: (n: number) => void; testID: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2], direction: 'ltr' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === n }}
          accessibilityLabel={t('track.stars', { n })}
          testID={`${testID}-${n}`}
          onPress={() => {
            theme.haptic('selection');
            onPick(n);
          }}
          hitSlop={4}
          style={({ pressed }) => ({ padding: 4, transform: [{ scale: pressed ? 0.88 : 1 }] })}
        >
          <Icon name="star" size={44} color={n <= value ? 'starOutline' : 'borderStrong'} fillColor="star" filled={n <= value} strokeWidth={1.6} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Two steps: the courier/driver, then the food (kitchen orders only). Step 1 is the courier's own
 * rating (before-launch §6): his stars, then optional one-tap reasons under them — what went wrong
 * for 1–3 — and «كمّل»; 4–5 moves straight on (the kind words come after as compliments). The food's stars send `orders.rate` straight away;
 * then the points this order earned count up and fly into the wallet. 1–3 on either (audit C-12)
 * offers "افتح شكوى" (a low food score first asks what was wrong with the food), which opens the
 * complaint (`orders.openDispute`, a support ticket) before the rating is stored, so the case stays
 * open with support. After a 4–5 rating «تحب تكرم عباس؟» offers a tip from the wallet (`TipOffer`;
 * the server decides whether and which chips).
 */
export function RatingPanel({ view, onDone }: { view: OrderTracking; onDone: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const rate = useRateOrder(view.order.id);
  const dispute = useOpenDispute(view.order.id);
  const food = (FOOD_RATED_TYPES as readonly string[]).includes(view.order.type) && view.merchant !== null;
  const ride = view.order.type === 'ride';
  const total = food ? 2 : 1;
  const [step, setStep] = useState<1 | 2 | 'reasons' | 'done'>(view.order.rating ? 'done' : 1);
  const [delivery, setDelivery] = useState(view.order.rating?.delivery ?? 0);
  const [foodScore, setFoodScore] = useState(view.order.rating?.food ?? 0);
  const [picked, setPicked] = useState<CourierRatingReason[]>([]);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [complained, setComplained] = useState(false);
  const name = view.courier?.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const canComplain = view.order.state === 'delivered' || view.order.state === 'completed';
  const busy = rate.isPending || dispute.isPending;
  // The tip is asked only after a good rating (4–5 on everything he rated); the server checks it again.
  const rated = view.order.rating ?? null;
  const goodRating = ratingBranch(rated?.delivery ?? delivery, food ? (rated?.food ?? foodScore) || null : null) === 'thanks' && (rated?.delivery ?? delivery) > 0;
  const offered = courierReasons(delivery, view.order.type);
  const foodReasons = lowReasons(view.order.type, food ? foodScore : null);

  const fail = (e: unknown) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
  const submit = (d: number, f: number | null, withTags: readonly RatingTag[] = []) => {
    // Only the reasons that fit the final score go (a 2 changed to a 5 sends none).
    const reasons = keepFitting(picked, d, view.order.type);
    rate.mutate(
      { orderId: view.order.id, delivery: d, ...(f ? { food: f } : {}), ...(withTags.length ? { tags: [...withTags] } : {}), ...(reasons.length ? { courierReasons: reasons } : {}) },
      { onSuccess: () => setStep('done'), onError: fail },
    );
  };
  const finish = (d: number, f: number | null) => (ratingBranch(d, f) === 'recover' ? setStep('reasons') : submit(d, f));
  const nextFromCourier = () => (food ? setStep(2) : finish(delivery, null));
  const complain = () => {
    const kind = disputeKindFor(tags, view.order.type, picked);
    const note = [...tags.map((tag) => reasonLabel(t, tag, ride)), ...picked.map((r) => t(`rating.courier.${r}` as MessageKey))].join('، ');
    dispute.mutate(
      { orderId: view.order.id, kind, ...(note ? { note } : {}) },
      {
        onSuccess: () => {
          setComplained(true);
          submit(delivery, food ? foodScore : null, tags);
        },
        onError: fail,
      },
    );
  };

  return (
    <BottomPanel onClose={step === 'done' ? onDone : undefined} testID="rating-panel">
      {step === 1 || step === 2 ? (
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="caption" color="textMuted" tabular>
            {t('track.rate_step', { n: step, total })}
          </Text>
          <Text variant="heading" align="center">
            {step === 1 ? t('track.rate_delivery_q', { name }) : t('track.rate_food_q', { merchant: view.merchant?.name ?? '' })}
          </Text>
        </View>
      ) : null}
      {step === 1 ? (
        <View style={{ gap: theme.space[4] }}>
          <Stars
            value={delivery}
            testID="stars-delivery"
            onPick={(n) => {
              setDelivery(n);
              setPicked((p) => keepFitting(p, n, view.order.type));
              // 4–5 moves straight on (the kind words come after, «شنو عجبك بـ حيدر؟»); 1–3 asks what went wrong.
              if (n > LOW_SCORE) {
                if (food) setTimeout(() => setStep(2), 220);
                else finish(n, null);
              }
            }}
          />
          {delivery > 0 && delivery <= LOW_SCORE ? (
            <View testID="courier-reasons" style={{ gap: theme.space[3] }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="label" weight={600} align="center">
                  {t('rating.courier_low_q', { name })}
                </Text>
                <Text variant="caption" color="textMuted" align="center">
                  {t('rating.courier_optional')}
                </Text>
              </View>
              <ChipGroup
                accessibilityLabel={t('rating.courier_low_q', { name })}
                items={offered.map((r) => ({ id: r, label: t(`rating.courier.${r}` as MessageKey) }))}
                value={picked}
                onChange={(next) => setPicked(next as CourierRatingReason[])}
                mode="multi"
                style={{ justifyContent: 'center' }}
              />
              <Button testID="rating-courier-next" label={food ? t('action.next') : t('rating.send')} fullWidth loading={rate.isPending} disabled={busy} onPress={nextFromCourier} />
            </View>
          ) : null}
        </View>
      ) : step === 2 && food ? (
        <Stars
          value={foodScore}
          testID="stars-food"
          onPick={(n) => {
            setFoodScore(n);
            setTimeout(() => finish(delivery, n), 160);
          }}
        />
      ) : step === 'reasons' ? (
        <View testID="rating-reasons" style={{ gap: theme.space[4] }}>
          <View style={{ alignItems: 'center', gap: theme.space[1] }}>
            <Text variant="heading" align="center">
              {foodReasons.length > 0 ? t('rating.low_title') : t('rating.sorry_title')}
            </Text>
            <Text variant="footnote" color="textMuted" align="center">
              {foodReasons.length > 0 ? t('rating.low_sub') : t('rating.open_complaint_hint')}
            </Text>
          </View>
          {foodReasons.length > 0 ? (
            <ChipGroup
              accessibilityLabel={t('rating.low_title')}
              items={foodReasons.map((tag) => ({ id: tag, label: reasonLabel(t, tag, ride) }))}
              value={tags}
              onChange={(next) => setTags(next as RatingTag[])}
              mode="multi"
              style={{ justifyContent: 'center' }}
            />
          ) : null}
          {canComplain ? (
            <View style={{ gap: theme.space[1] }}>
              <Button testID="rating-complain" icon="chat" label={t('rating.open_complaint')} fullWidth loading={dispute.isPending} disabled={busy} onPress={complain} />
              {foodReasons.length > 0 ? (
                <Text variant="caption" color="textMuted" align="center">
                  {t('rating.open_complaint_hint')}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Button testID="rating-send" variant="secondary" label={t('rating.send')} fullWidth loading={rate.isPending && !dispute.isPending} disabled={busy} onPress={() => submit(delivery, food ? foodScore : null, tags)} />
        </View>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {complained ? (
            <View testID="rating-complaint-opened" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
              <Icon name="shield" size={18} color="successText" strokeWidth={2.2} />
              <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
                {t('rating.complaint_opened')}
              </Text>
            </View>
          ) : null}
          <PointsEarned points={view.pointsEarned} />
          {/* Joy l4: kind words for him first, then the tip offer exactly as before (rating → tip). */}
          <ComplimentCard orderId={view.order.id} name={name} enabled={!complained && goodRating} />
          <TipOffer orderId={view.order.id} name={name} enabled={!complained && goodRating} />
        </View>
      )}
      {step === 1 || step === 2 ? (
        <Button label={t('track.rate_later')} variant="ghost" fullWidth onPress={onDone} disabled={busy} loading={rate.isPending && step === 2} />
      ) : step === 'done' ? (
        <Button label={t('action.done')} fullWidth onPress={onDone} testID="rating-done" />
      ) : null}
    </BottomPanel>
  );
}

/** The chip for a reason ("الأكل بارد"); "rude" names the driver on rides, the courier otherwise. */
function reasonLabel(t: ReturnType<typeof useT>, tag: RatingTag, ride: boolean): string {
  if (tag === 'rude') return t(ride ? 'rating.tag.rude_ride' : 'rating.tag.rude');
  return t(`rating.tag.${tag}` as MessageKey);
}

/** "+42 نقطة" counting up, then a coin flying into the wallet icon. */
function PointsEarned({ points }: { points: number | null }) {
  const theme = useTheme();
  const t = useT();
  const today = useSeason();
  const [target, setTarget] = useState(0);
  const shown = useCountUp(target);
  const fly = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (!points) return;
    setTarget(points);
    fly.value = withDelay(700, withTiming(1, { duration: 650, easing: Easing.in(Easing.cubic) }));
    pop.value = withDelay(1300, withSequence(withSpring(1.25, { damping: 6 }), withSpring(1)));
    if (today.celebrations) theme.haptic('success');
  }, [points, fly, pop, theme, today.celebrations]);
  // The coin travels from the number to the wallet badge on the end side.
  const coin = useAnimatedStyle(() => ({
    opacity: fly.value === 0 || fly.value === 1 ? 0 : 1,
    transform: [{ translateX: -110 * fly.value }, { translateY: -10 * Math.sin(Math.PI * fly.value) * 4 }, { scale: 1 - 0.4 * fly.value }],
  }));
  const wallet = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View testID="points-earned" style={{ alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[2] }}>
      <Text variant="title" align="center">
        {t('track.rate_thanks')}
      </Text>
      {points ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4], direction: 'ltr' }}>
          <Animated.View style={[{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }, wallet]}>
            <Icon name="wallet" size={28} color="accentText" strokeWidth={2} />
          </Animated.View>
          <View style={{ alignItems: 'center' }}>
            <Animated.View style={[{ position: 'absolute', top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.accentText }, coin]} />
            <Text variant="display" color="accentText" tabular testID="points-value">
              {ltr(`+${shown}`)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('points.earned', { n: points })}
            </Text>
          </View>
        </View>
      ) : (
        <Text color="textMuted" align="center">
          {t('track.points_soon')}
        </Text>
      )}
      {points ? (
        <Text variant="caption" color="successText">
          {t('track.points_to_wallet')}
        </Text>
      ) : null}
    </View>
  );
}
