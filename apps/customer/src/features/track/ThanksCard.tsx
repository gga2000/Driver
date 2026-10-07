import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { FOOD_RATED_TYPES, type CourierRatingReason, type OrderTracking, type RatingTag } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, ChipGroup, formatClock, Icon, SketchScene, Text, usePhotoFallback, useTheme, useToast } from '@driver/ui';
import { useMyPlaces } from '@/features/account/queries';
import { photoUri } from '@/features/account/device';
import { firstKindForOrder } from '@/features/firsts/firsts';
import { FirstMoment, useOrderFirsts } from '@/features/firsts/FirstMoment';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { useSeason } from '@/lib/use-season';
import { gatePhotoFor } from './arrival-logic';
import { Stars } from './Arrival';
import { ChangeCreditStrip } from './ChangeCredited';
import { ComplimentCard } from './Compliments';
import { DishBurst } from './DishBurst';
import { promiseCopy } from './late-promise';
import { useOpenDispute, useRateOrder, useTipOptions, useTipOrder } from './queries';
import { courierReasons, disputeKindFor, keepFitting, lowReasons, LOW_SCORE, ratingBranch, tipCard } from './rating-logic';
import { autoSendRating, paidLine } from './track-v2';

/**
 * The delivered order as one thank-you card (after-order design a3 + a5 + r1 + r3): one picture (the
 * gate photo he saved for that place, else the drawn door), «بالعافية», what he paid in the past tense
 * from what the server recorded (HUNT-05), the coin strip when the rest of his note went to his wallet,
 * then the courier's stars, the food's stars, and — after a good rating — the kind words and the tip.
 * The rating rules are the old panel's, unchanged: 1–3 asks what went wrong and offers the complaint
 * before the rating is stored; 4–5 sends itself. The tip's amounts and eligibility are the server's.
 */
export function ThanksCard({ view, canRate }: { view: OrderTracking; canRate: boolean }) {
  const theme = useTheme();
  const t = useT();
  const places = useMyPlaces();
  const today = useSeason();
  const firsts = useOrderFirsts();
  const first = firstKindForOrder(view.order.id, firsts.data);
  const photo = gatePhotoFor(view.dropoff, places.data ?? []);
  const gate = usePhotoFallback(photo ? photoUri(photo) : null);
  const deliveredAt = view.order.deliveredAt ?? view.order.closedAt ?? null;
  const celebrate = today.celebrations && !theme.reduceMotion;
  return (
    <View testID="track-thanks" style={{ gap: theme.space[4] }}>
      <View style={{ alignItems: 'center', gap: theme.space[2] }}>
        {gate.uri ? (
          <Image
            testID="thanks-photo"
            source={{ uri: gate.uri }}
            onError={gate.onError}
            accessibilityLabel={t('track.arrived_gate')}
            resizeMode="cover"
            style={{ width: '100%', height: 168, borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}
          />
        ) : (
          <View testID="thanks-scene" style={{ width: '100%', maxWidth: 200 }}>
            <SketchScene name="door" />
          </View>
        )}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="display" align="center" accessibilityRole="header" style={{ fontSize: 34, lineHeight: 48 }}>
            {t('track2.thanks_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" tabular>
            {deliveredAt ? t('track2.thanks_sub', { merchant: view.merchant?.name ?? '', time: formatClock(deliveredAt) }) : t('track.arrived_food', { merchant: view.merchant?.name ?? '' })}
          </Text>
          {celebrate ? <DishBurst /> : null}
        </View>
      </View>
      <FirstMoment kind={first} />
      <PaidCard view={view} />
      {/* A closed order is past its rating window (the old screen asked only while delivered). */}
      {canRate || view.order.rating ? <RateCard view={view} /> : null}
    </View>
  );
}

/** What he paid, said after the fact: «دفعت 17,500 دينار كاش», the coin strip, the honest-delay credit. */
function PaidCard({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const paid = paidLine(view.order);
  const credit = view.latePromise?.credit ?? null;
  return (
    <View style={{ gap: theme.space[2] }}>
      {paid.kind === 'cash' && paid.creditedIqd > 0 ? (
        <>
          <ChangeCreditStrip amountIqd={paid.creditedIqd} />
          <Text variant="label" weight={600} align="center" tabular testID="thanks-paid">
            {t('cashchange.arrival_paid_total', { total: amountParam(paid.totalIqd), paid: amountParam(paid.paidIqd) })}
          </Text>
        </>
      ) : (
        <View testID="thanks-paid" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
          <Icon name={paid.kind === 'cash' ? 'cash' : 'wallet'} size={18} color="text" strokeWidth={2.2} />
          <Text variant="label" weight={600} tabular style={{ flex: 1 }}>
            {paid.kind === 'cash' ? t('cashchange.receipt_paid', { amount: amountParam(paid.totalIqd) }) : t('track.paid_wallet', { amount: amountParam(paid.amountIqd) })}
          </Text>
        </View>
      )}
      {credit && view.latePromise ? (
        <View testID="thanks-late-credit" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
          <Icon name="gift" size={18} color="successText" strokeWidth={2.2} />
          <Text variant="label" weight={600} color="successText" tabular style={{ flex: 1 }}>
            {t(promiseCopy(view.latePromise.basis).credited, { amount: amountParam(credit.amountIqd) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The courier's stars, the food's, then (after a good rating) the kind words and the tip. */
function RateCard({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const rate = useRateOrder(view.order.id);
  const dispute = useOpenDispute(view.order.id);
  const food = (FOOD_RATED_TYPES as readonly string[]).includes(view.order.type) && view.merchant !== null;
  const rated = view.order.rating ?? null;
  const [step, setStep] = useState<'rate' | 'reasons' | 'done'>(rated ? 'done' : 'rate');
  const [delivery, setDelivery] = useState(rated?.delivery ?? 0);
  const [foodScore, setFoodScore] = useState(rated?.food ?? 0);
  const [picked, setPicked] = useState<CourierRatingReason[]>([]);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [complained, setComplained] = useState(false);
  const name = view.courier?.firstName ?? t('track.courier_fallback');
  const canComplain = view.order.state === 'delivered' || view.order.state === 'completed';
  const busy = rate.isPending || dispute.isPending;
  const offered = courierReasons(delivery, view.order.type);
  const foodReasons = lowReasons(view.order.type, food ? foodScore : null);
  const goodRating = ratingBranch(rated?.delivery ?? delivery, food ? (rated?.food ?? foodScore) || null : null) === 'thanks' && (rated?.delivery ?? delivery) > 0;

  const fail = (e: unknown) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
  const submit = (d: number, f: number | null, withTags: readonly RatingTag[] = []) => {
    const reasons = keepFitting(picked, d, view.order.type);
    rate.mutate(
      { orderId: view.order.id, delivery: d, ...(f ? { food: f } : {}), ...(withTags.length ? { tags: [...withTags] } : {}), ...(reasons.length ? { courierReasons: reasons } : {}) },
      { onSuccess: () => setStep('done'), onError: fail },
    );
  };

  // A good score sends itself a beat after the last star (the old panel's rhythm); a change of mind
  // within that beat starts it over.
  const auto = step === 'rate' && autoSendRating(delivery, food ? foodScore : null, Boolean(rated));
  const sent = useRef(false);
  useEffect(() => {
    if (!auto || sent.current) return;
    const id = setTimeout(() => {
      sent.current = true;
      submit(delivery, food ? foodScore : null);
    }, 450);
    return () => clearTimeout(id);
    // `submit` closes over the same scores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, delivery, foodScore]);

  const complain = () => {
    const kind = disputeKindFor(tags, view.order.type, picked);
    const note = [...tags.map((tag) => t(`rating.tag.${tag}` as MessageKey)), ...picked.map((r) => t(`rating.courier.${r}` as MessageKey))].join('، ');
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
  const ready = delivery > 0 && (!food || foodScore > 0);
  const locked = step !== 'rate' || busy;

  return (
    <View style={{ gap: theme.space[3] }}>
      <View testID="thanks-rate" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          {view.courier ? <Avatar name={name} uri={apiPhoto(view.courier.photoUrl) ?? undefined} size={52} /> : null}
          <Text variant="heading" align="center">
            {t('track.rate_delivery_q', { name })}
          </Text>
        </View>
        <View pointerEvents={locked ? 'none' : 'auto'}>
          <Stars
            value={delivery}
            testID="stars-delivery"
            onPick={(n) => {
              sent.current = false;
              rate.reset();
              setDelivery(n);
              setPicked((p) => keepFitting(p, n, view.order.type));
            }}
          />
        </View>
        {step === 'rate' && delivery > 0 && delivery <= LOW_SCORE ? (
          <View testID="courier-reasons" style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} align="center">
              {t('rating.courier_low_q', { name })}
            </Text>
            <ChipGroup
              accessibilityLabel={t('rating.courier_low_q', { name })}
              items={offered.map((r) => ({ id: r, label: t(`rating.courier.${r}` as MessageKey) }))}
              value={picked}
              onChange={(next) => setPicked(next as CourierRatingReason[])}
              mode="multi"
              style={{ justifyContent: 'center' }}
            />
          </View>
        ) : null}
      </View>

      {food && delivery > 0 ? (
        <Animated.View
          entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
          testID="thanks-food"
          style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
        >
          <Text variant="title" align="center">
            {t('track.rate_food_q', { merchant: view.merchant?.name ?? '' })}
          </Text>
          <View pointerEvents={locked ? 'none' : 'auto'}>
            <Stars
              value={foodScore}
              testID="stars-food"
              onPick={(n) => {
                sent.current = false;
              rate.reset();
                setFoodScore(n);
              }}
            />
          </View>
        </Animated.View>
      ) : null}

      {/* «كمّل» when the score needs a word first, or to try again when a good score did not go through. */}
      {step === 'rate' && ready && (!auto || rate.isError) ? (
        <Button testID="thanks-continue" label={t('action.next')} fullWidth loading={rate.isPending} disabled={busy} onPress={() => (ratingBranch(delivery, food ? foodScore : null) === 'recover' ? setStep('reasons') : submit(delivery, food ? foodScore : null))} />
      ) : null}

      {step === 'reasons' ? (
        <View testID="rating-reasons" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
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
              items={foodReasons.map((tag) => ({ id: tag, label: t(`rating.tag.${tag}` as MessageKey) }))}
              value={tags}
              onChange={(next) => setTags(next as RatingTag[])}
              mode="multi"
              style={{ justifyContent: 'center' }}
            />
          ) : null}
          {canComplain ? <Button testID="rating-complain" icon="chat" label={t('rating.open_complaint')} fullWidth loading={dispute.isPending} disabled={busy} onPress={complain} /> : null}
          <Button testID="rating-send" variant="secondary" label={t('rating.send')} fullWidth loading={rate.isPending && !dispute.isPending} disabled={busy} onPress={() => submit(delivery, food ? foodScore : null, tags)} />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={{ gap: theme.space[3] }}>
          {complained ? (
            <View testID="rating-complaint-opened" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
              <Icon name="shield" size={18} color="successText" strokeWidth={2.2} />
              <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
                {t('rating.complaint_opened')}
              </Text>
            </View>
          ) : null}
          <PointsLine points={view.pointsEarned} />
          <ComplimentCard orderId={view.order.id} name={name} enabled={!complained && goodRating} />
          <TipCard orderId={view.order.id} name={name} enabled={!complained && goodRating} />
        </View>
      ) : null}
    </View>
  );
}

/** «شكراً، تقييمك وصلهم · كسبت 25 نقطة» (or that they land in a few minutes). */
function PointsLine({ points }: { points: number | null }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
      testID="points-earned"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint }}
    >
      <Icon name="star" size={22} color="accentText" filled fillColor="accent" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700}>
          {t('track.rate_thanks')}
        </Text>
        <Text variant="caption" color="textMuted" tabular testID="points-value">
          {points ? `${t('points.earned', { n: points })} · ${t('track.points_to_wallet')}` : t('track.points_soon')}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * «تحب تكرم حيدر؟» (r3): only the amounts his wallet covers (the server's chips), and a button that
 * never looks broken — outlined «اختار مبلغ» until a chip is picked (a tap then points at the chips),
 * then «كرّمه بـ 1,000 دينار». «لا شكراً» closes it. With too little in the wallet: the cash line.
 */
function TipCard({ orderId, name, enabled }: { orderId: string; name: string; enabled: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const offer = useTipOptions(orderId, enabled);
  const send = useTipOrder(orderId);
  const [picked, setPicked] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const card = enabled ? tipCard(offer.data, dismissed) : 'hidden';
  if (card === 'hidden') return null;
  if (card === 'thanks') {
    return (
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(220)} testID="tip-thanks" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
        <Icon name="gift" size={22} color="successText" />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600} color="successText">
            {t('tip.done', { name })}
          </Text>
          <Text variant="caption" color="text" tabular>
            {t('tip.done_amount', { amount: amountParam(offer.data?.tip?.amountIqd ?? 0) })}
          </Text>
        </View>
      </Animated.View>
    );
  }
  if (card === 'cash_note') {
    return (
      <View testID="tip-cash-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <Icon name="cash" size={22} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('tip.cash_note', { name })}
        </Text>
      </View>
    );
  }
  const amounts = offer.data?.amountsIqd ?? [];
  const submit = () => {
    if (picked === null) {
      theme.haptic('selection');
      toast.show({ message: t('track2.tip_pick_hint'), tone: 'info' });
      return;
    }
    send.mutate({ orderId, amountIqd: picked }, { onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }) });
  };
  return (
    <View testID="tip-offer" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="heading" align="center">
          {t('tip.ask', { name })}
        </Text>
        <Text variant="footnote" color="textMuted" align="center">
          {t('tip.ask_sub')}
        </Text>
      </View>
      <ChipGroup
        accessibilityLabel={t('tip.ask', { name })}
        items={amounts.map((a) => ({ id: String(a), label: amountParam(a), accessibilityLabel: t('tip.chip', { amount: amountParam(a) }) }))}
        value={picked === null ? [] : [String(picked)]}
        onChange={(next) => setPicked(next[0] ? Number(next[0]) : null)}
        mode="single"
        columns={amounts.length}
      />
      <Button
        testID="tip-send"
        icon="gift"
        variant={picked === null ? 'secondary' : 'primary'}
        label={picked === null ? t('tip.pick') : t('tip.pay', { amount: amountParam(picked) })}
        fullWidth
        disabled={send.isPending}
        loading={send.isPending}
        onPress={submit}
      />
      <Button testID="tip-no-thanks" variant="ghost" label={t('tip.no_thanks')} fullWidth disabled={send.isPending} onPress={() => setDismissed(true)} />
    </View>
  );
}
