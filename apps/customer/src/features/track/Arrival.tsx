import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, ZoomIn, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOOD_RATED_TYPES, type OrderTracking, type RatingTag } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, ChipGroup, Icon, ltr, Text, useCountUp, useTheme, useToast } from '@driver/ui';
import { useMyPlaces } from '@/features/account/queries';
import { photoUri } from '@/features/account/device';
import { apiErrorMessage } from '@/lib/api';
import { amountParam, iqd } from '@/lib/money';
import { useLocale, useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { RideArrivalSummary } from '@/features/ride/LiveParts';
import { arrivalPlays, arrivalSeenKey, cashAtDoor, gatePhotoFor } from './arrival-logic';
import { ChangeCreditStrip } from './ChangeCredited';
import { BottomPanel } from './Panels';
import { useOpenDispute, useRateOrder } from './queries';
import { disputeKindFor, lowReasons, ratingBranch } from './rating-logic';
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
  const photo = ride ? null : gatePhotoFor(view.dropoff, places.data ?? []);
  const pay = cashAtDoor(view.order);
  const today = useSeason();
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
        <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
          {celebrate ? <Burst /> : null}
          <Animated.View
            entering={celebrate ? ZoomIn.springify().damping(11) : theme.reduceMotion ? undefined : FadeIn.duration(220)}
            style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: theme.colors.accent, shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } }}
          >
            <Icon name="check" size={48} color="onAccent" strokeWidth={3} />
          </Animated.View>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="display" style={{ fontSize: 36, lineHeight: 52 }} accessibilityRole="header" align="center">
            {ride ? t('track.arrived_title_ride') : t('track.arrived_title_food')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {ride ? t('track.arrived_ride') : t('track.arrived_food', { merchant: view.merchant?.name ?? '' })}
          </Text>
        </View>
        {/* A ride ends wherever the rider asked, not at a door: its own fare summary instead. */}
        {ride ? (
          <RideArrivalSummary view={view} />
        ) : (
          <>
            {photo ? (
              <View testID="arrival-photo" style={{ width: '100%', flexShrink: 1, gap: theme.space[1] }}>
                <Image
                  source={{ uri: photoUri(photo) }}
                  accessibilityLabel={t('track.arrived_gate')}
                  resizeMode="cover"
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
        <Button label={t('track.arrived_continue')} icon="star" size="lg" fullWidth onPress={onRate} testID="arrival-rate" />
        <Button label={t('track.rate_later')} variant="ghost" fullWidth onPress={onLater} />
      </View>
    </Animated.View>
  );
}

/** The burst behind the check (maps program SP5b, c7): one short spray of brand dots, 900 ms, once. */
const BURST_MS = 900;
const BURST_DOTS = 14;
const BURST_REACH = 92;

function Burst() {
  const theme = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.cubic) });
  }, [p]);
  const tones = [theme.colors.accent, theme.colors.success, theme.colors.info, theme.colors.warning];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {Array.from({ length: BURST_DOTS }, (_, i) => (
        <BurstDot key={i} p={p} angle={(i / BURST_DOTS) * Math.PI * 2 + (i % 2) * 0.18} reach={BURST_REACH * (i % 3 === 0 ? 1 : 0.78)} size={i % 3 === 0 ? 10 : 7} color={tones[i % tones.length]!} />
      ))}
    </View>
  );
}

function BurstDot({ p, angle, reach, size, color }: { p: SharedValue<number>; angle: number; reach: number; size: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.6 ? 1 : 1 - (p.value - 0.6) / 0.4,
    transform: [{ translateX: Math.cos(angle) * reach * p.value }, { translateY: Math.sin(angle) * reach * p.value }, { scale: 1.2 - 0.6 * p.value }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
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
        <Text variant="footnote" color="textMuted" align="center" tabular testID="arrival-paid-note">
          {t('cashchange.receipt_paid', { amount: amountParam(pay.paidIqd) })}
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

function Stars({ value, onPick, testID }: { value: number; onPick: (n: number) => void; testID: string }) {
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
          <Icon name="star" size={44} color={n <= value ? 'accent' : 'borderStrong'} filled={n <= value} strokeWidth={1.6} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Two taps: the courier/driver, then the food (kitchen orders only). 4–5 stars send `orders.rate`
 * straight away; then the points this order earned count up and fly into the wallet. 1–3 on either
 * (audit C-12) asks what went wrong — one-tap reasons stored as rating tags — and offers "افتح شكوى",
 * which opens the complaint (`orders.openDispute`, a support ticket) before the rating is stored, so
 * the case stays open with support. No tip here: the API takes tips only at checkout.
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
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [complained, setComplained] = useState(false);
  const name = view.courier?.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const canComplain = view.order.state === 'delivered' || view.order.state === 'completed';
  const busy = rate.isPending || dispute.isPending;

  const fail = (e: unknown) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
  const submit = (d: number, f: number | null, withTags: readonly RatingTag[] = []) =>
    rate.mutate({ orderId: view.order.id, delivery: d, ...(f ? { food: f } : {}), ...(withTags.length ? { tags: [...withTags] } : {}) }, { onSuccess: () => setStep('done'), onError: fail });
  const finish = (d: number, f: number | null) => (ratingBranch(d, f) === 'recover' ? setStep('reasons') : submit(d, f));
  const complain = () => {
    const kind = disputeKindFor(tags, view.order.type);
    const note = tags.map((tag) => reasonLabel(t, tag, ride)).join('، ');
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
        <Stars
          value={delivery}
          testID="stars-delivery"
          onPick={(n) => {
            setDelivery(n);
            if (food) setTimeout(() => setStep(2), 220);
            else finish(n, null);
          }}
        />
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
              {t('rating.low_title')}
            </Text>
            <Text variant="footnote" color="textMuted" align="center">
              {t('rating.low_sub')}
            </Text>
          </View>
          <ChipGroup
            accessibilityLabel={t('rating.low_title')}
            items={lowReasons(view.order.type).map((tag) => ({ id: tag, label: reasonLabel(t, tag, ride) }))}
            value={tags}
            onChange={(next) => setTags(next as RatingTag[])}
            mode="multi"
            style={{ justifyContent: 'center' }}
          />
          {canComplain ? (
            <View style={{ gap: theme.space[1] }}>
              <Button testID="rating-complain" icon="chat" label={t('rating.open_complaint')} fullWidth loading={dispute.isPending} disabled={busy} onPress={complain} />
              <Text variant="caption" color="textMuted" align="center">
                {t('rating.open_complaint_hint')}
              </Text>
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
        </View>
      )}
      {step === 1 || step === 2 ? (
        <Button label={t('track.rate_later')} variant="ghost" fullWidth onPress={onDone} disabled={busy} loading={rate.isPending} />
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
