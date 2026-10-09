import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import type { GuaranteeWindowView, HandoverProof, UnreachableStatus } from '@driver/contracts';
import { AmountPad, Button, Icon, SlideToConfirm, Text, useTheme } from '@driver/ui';
import { pickPhoto, type PickedPhoto } from '@/features/account/photo';
import { playDoneTink } from '@/lib/alert';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { doorChips, doorHandover, doorState, WALLET_CAP_IQD } from './cash-door';
import { JobEndFrame, JobEndHero, JobEndNext, type JobEndDay, type JobEndDemand } from './JobEnd';
import { clock, unreachablePhase } from './logic';

/**
 * Handover at the door: the photo (protects him in a dispute) and, for cash orders, the cash helper
 * ("الخردة علينا", partner S-2): the amount to collect at display size, "الزبون دفع:" chips (the note
 * the customer said at checkout first, then the exact amount and the notes above it, then "غير" on a
 * number pad), the live "رجّعله 6,000 دينار", and — when he has no change — "ما عندي خردة · حطها رصيد
 * بمحفظته", which records the whole note and puts the rest in the customer's wallet (cash orders, up to
 * 25,000, in 250s; the server checks it again). Confirming is a slide ("استلمت 25,000 دينار") that
 * writes `trips.completeStop`.
 * The photo is uploaded first (maps program f11; support sees it on a dispute, deleted after 30 days).
 */
export function HandoverPanel({
  collectIqd,
  owedFeesIqd,
  tenderIqd,
  busy,
  onConfirm,
  onClose,
}: {
  collectIqd: number;
  /** M-3: of `collectIqd`, the earlier cancel fees the customer pays with this order; absent/0 = none. */
  owedFeesIqd?: number;
  /** The note the customer said he will pay with; null/absent = none. */
  tenderIqd?: number | null;
  busy: boolean;
  onConfirm: (photo: PickedPhoto | null, cash: Pick<HandoverProof, 'cashCollectedIqd' | 'changeToWalletIqd'> | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const photo = picked?.uri ?? null;
  const cash = collectIqd > 0;
  const chips = useMemo(() => doorChips(collectIqd, tenderIqd), [collectIqd, tenderIqd]);
  // The customer's own word is the likeliest note; the exact amount otherwise.
  const [paid, setPaid] = useState(tenderIqd && tenderIqd >= collectIqd ? tenderIqd : collectIqd);
  const [noChange, setNoChange] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const door = doorState(collectIqd, paid);
  const other = !chips.some((c) => c.amountIqd === paid);

  const pick = (amountIqd: number) => {
    setPaid(amountIqd);
    setNoChange(false);
  };

  const take = async () => {
    // The camera; where there is none (a desktop browser), the photo library. Without either he can
    // still confirm without a photo.
    const shot = await pickPhoto('camera').catch(() => null);
    const got = shot && shot !== 'denied' ? shot : await pickPhoto('library').catch(() => null);
    if (got && got !== 'denied') {
      setPicked(got);
      theme.haptic('success');
    }
  };

  const typed = pad === null ? 0 : Number(pad || '0');
  const padShort = typed < collectIqd;

  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="handover-panel" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">{cash ? t('partner.cash_title') : t('partner.photo_title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} hitSlop={12}>
          <Icon name="x" size={22} color="textMuted" />
        </Pressable>
      </View>

      {cash && pad === null ? (
        <View testID="cash-owed" style={{ alignItems: 'center', gap: 2, backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.xl, paddingVertical: theme.space[4] }}>
          <Text variant="label" color="warningText">
            {t('partner.cash_owed')}
          </Text>
          <Text tabular weight={700} color="text" style={{ fontSize: 40, lineHeight: 56 }}>
            {`${amountParam(collectIqd)} `}
            <Text variant="title" color="textMuted">
              {t('quote.currency')}
            </Text>
          </Text>
          {owedFeesIqd && owedFeesIqd > 0 ? (
            <Text testID="cash-owed-split" variant="label" weight={600} color="text" tabular align="center" style={{ paddingHorizontal: theme.space[4] }}>
              {t('partner.cash_owed_split', { order: amountParam(collectIqd - owedFeesIqd), fees: amountParam(owedFeesIqd) })}
            </Text>
          ) : null}
          <Text variant="caption" color="warningText" align="center" style={{ paddingHorizontal: theme.space[4] }}>
            {t('partner.cash_hint')}
          </Text>
        </View>
      ) : null}

      {cash && pad !== null ? (
        <View testID="tender-pad" style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="label" weight={600}>
              {t('cashchange.pad_title')}
            </Text>
            <Pressable testID="tender-pad-close" accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={() => setPad(null)} hitSlop={12}>
              <Icon name="x" size={20} color="textMuted" />
            </Pressable>
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="numeralSm" tabular testID="tender-pad-value" color={pad ? 'text' : 'textMuted'}>
              {`${amountParam(typed)} `}
              <Text variant="label" color="textMuted">
                {t('quote.currency')}
              </Text>
            </Text>
            <Text variant="caption" color={pad && padShort ? 'warningText' : 'textMuted'} tabular>
              {t('cashchange.pad_min', { amount: amountParam(collectIqd) })}
            </Text>
          </View>
          <AmountPad value={pad} onChange={setPad} deleteLabel={t('cashchange.pad_delete')} testID="tender-pad-keys" />
          <Button
            testID="tender-pad-done"
            label={t('cashchange.pad_done')}
            size="lg"
            fullWidth
            disabled={padShort}
            onPress={() => {
              pick(typed);
              setPad(null);
            }}
          />
        </View>
      ) : cash ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="label" color="textMuted">
            {t('cashchange.door_paid_label')}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('cashchange.door_paid_label')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {chips.map((c) => (
              <NoteChip
                key={c.amountIqd}
                testID={`tender-chip-${c.amountIqd}`}
                amount={amountParam(c.amountIqd)}
                tag={c.stated ? t('cashchange.door_said') : c.exact ? t('cashchange.pay_with_exact') : null}
                label={t('cashchange.door_chip_a11y', { amount: amountParam(c.amountIqd) })}
                selected={paid === c.amountIqd}
                onPress={() => pick(c.amountIqd)}
              />
            ))}
            <NoteChip
              testID="tender-chip-other"
              amount={other ? amountParam(paid) : t('cashchange.door_other')}
              tag={other ? t('cashchange.door_other') : null}
              label={t('cashchange.door_other')}
              selected={other}
              onPress={() => setPad('')}
            />
          </View>

          {door.changeIqd > 0 ? (
            noChange && door.walletAllowed ? (
              <Animated.View
                testID="door-no-change-on"
                entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
                style={{ gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                  <View style={{ marginTop: 3 }}>
                    <Icon name="wallet" size={20} color="successText" strokeWidth={2.2} />
                  </View>
                  <Text variant="bodyStrong" color="successText" style={{ flex: 1 }} accessibilityLiveRegion="polite">
                    {t('cashchange.door_no_change_on', { amount: amountParam(door.changeIqd) })}
                  </Text>
                </View>
                <Button testID="door-have-change" label={t('cashchange.door_have_change')} variant="ghost" size="sm" onPress={() => setNoChange(false)} />
              </Animated.View>
            ) : (
              <View style={{ gap: theme.space[2] }}>
                <Animated.View
                  key={door.changeIqd}
                  entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
                  testID="door-give-back"
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={t('cashchange.door_give_back', { amount: amountParam(door.changeIqd) })}
                  style={{ alignItems: 'center', gap: 2, paddingVertical: theme.space[4], paddingHorizontal: theme.space[3], borderRadius: theme.radius.xl, backgroundColor: theme.colors.successTint }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                    <Icon name="cash" size={20} color="successText" strokeWidth={2.2} />
                    <Text variant="label" weight={700} color="successText">
                      {t('partner.give_back_label')}
                    </Text>
                  </View>
                  <Text tabular weight={700} color="successText" style={{ fontSize: 44, lineHeight: 60 }}>
                    {`${amountParam(door.changeIqd)} `}
                    <Text variant="title" color="successText">
                      {t('quote.currency')}
                    </Text>
                  </Text>
                </Animated.View>
                {door.walletAllowed ? (
                  <Button testID="door-no-change" label={t('cashchange.door_no_change')} variant="secondary" icon="wallet" fullWidth onPress={() => setNoChange(true)} />
                ) : door.walletBlock === 'above_cap' ? (
                  <Text testID="door-over-cap" variant="footnote" color="warningText" tabular>
                    {t('cashchange.door_over_cap', { amount: amountParam(WALLET_CAP_IQD) })}
                  </Text>
                ) : null}
              </View>
            )
          ) : (
            <Text testID="door-exact" variant="footnote" color="textMuted">
              {t('cashchange.door_exact')}
            </Text>
          )}
        </View>
      ) : null}

      {pad === null ? (
        <>
          <Pressable
            testID="handover-photo"
            accessibilityRole="button"
            onPress={() => void take()}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              padding: theme.space[3],
              borderRadius: theme.radius.lg,
              borderWidth: 1.5,
              borderStyle: photo ? 'solid' : 'dashed',
              borderColor: photo ? theme.colors.success : theme.colors.borderStrong,
              backgroundColor: photo ? theme.colors.successTint : theme.colors.surface,
            }}
          >
            {photo ? (
              <Image source={{ uri: photo }} style={{ width: 56, height: 56, borderRadius: 12 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={24} color="textMuted" />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight={600} color={photo ? 'successText' : 'text'}>
                {photo ? t('partner.photo_saved') : t('partner.handover_photo')}
              </Text>
              <Text variant="caption" color="textMuted">
                {photo ? t('partner.photo_retake') : t('partner.photo_hint')}
              </Text>
            </View>
          </Pressable>

          {/* Handing over (and taking the cash) can't be undone: a slide, never a pocket tap (P-08). */}
          <SlideToConfirm
            testID="handover-confirm"
            label={cash ? t('partner.cash_confirm', { amount: amountParam(paid) }) : t('partner.action_delivered')}
            loading={busy}
            onConfirm={() => onConfirm(picked, cash ? doorHandover(collectIqd, paid, noChange) : null)}
          />
        </>
      ) : null}
    </Animated.View>
  );
}

/** One note the customer may have handed over: a big tabular amount, a small tag ("گال", "بالضبط"). */
function NoteChip({ amount, tag, label, selected, onPress, testID }: { amount: string; tag: string | null; label: string; selected: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-checked={selected}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 52,
        minWidth: 92,
        flexGrow: 1,
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[1],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accentBorder : theme.colors.border,
        backgroundColor: selected ? theme.colors.accent : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {selected ? <Icon name="check" size={16} color="onAccent" strokeWidth={2.6} /> : null}
        <Text variant="title" weight={700} tabular color={selected ? 'onAccent' : 'text'} compact>
          {amount}
        </Text>
      </View>
      {tag ? (
        <Text variant="caption" weight={600} color={selected ? 'onAccent' : 'accentText'} compact>
          {tag}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Unreachable-customer protocol (domain §2): we call and WhatsApp the customer, the dispatcher
 * joins at 3:00, and from 5:00 he may end the job (the customer pays). Calm, factual, with the
 * clock always visible.
 */
export function UnreachablePanel({ status, busy, onFail, onResponded }: { status: UnreachableStatus; busy: boolean; onFail: () => void; onResponded: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const p = unreachablePhase(status, now);
  const c = clock(p.remainingMs);
  const steps = [
    { key: 'call', label: t('partner.unreachable_step_call'), done: true },
    { key: 'dispatch', label: p.dispatcherAlerted ? t('unreachable.driver_dispatcher_alerted') : t('partner.unreachable_step_dispatch'), done: p.dispatcherAlerted },
    { key: 'end', label: t('partner.unreachable_step_end'), done: p.canFail },
  ];
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="unreachable-panel" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 6, borderColor: p.canFail ? theme.colors.danger : theme.colors.warning, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="heading" tabular testID="unreachable-clock" color={p.canFail ? 'dangerText' : 'text'}>
            {`${c.minutes}:${c.seconds}`}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">{t('partner.unreachable_title')}</Text>
          <Text variant="footnote" color="textMuted">
            {p.canFail ? t('unreachable.driver_mark_failed_hint') : t('unreachable.driver_calling')}
          </Text>
        </View>
      </View>
      {/* Joy J-D8: the customer tapped «أني نازل» — the timer already includes his 2 extra minutes. */}
      {status.extendedAt && !p.canFail ? (
        <View testID="unreachable-customer-coming" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
          <Icon name="user" size={18} color="successText" />
          <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
            {t('unreachable.driver_customer_coming')}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        {steps.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: s.done ? theme.colors.success : theme.colors.surfaceSunken }}>
              {s.done ? <Icon name="check" size={14} color="surface" strokeWidth={3} /> : <Icon name="clock" size={14} color="textMuted" />}
            </View>
            <Text variant="label" color={s.done ? 'text' : 'textMuted'} style={{ flex: 1 }}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Button testID="unreachable-responded" label={t('unreachable.driver_customer_responded')} variant="secondary" size="lg" fullWidth onPress={onResponded} />
        <Button
          testID="unreachable-fail"
          label={p.canFail ? t('unreachable.driver_mark_failed') : t('unreachable.driver_timer', { minutes: c.minutes, seconds: c.seconds })}
          variant="destructive"
          size="lg"
          fullWidth
          disabled={!p.canFail}
          loading={busy}
          onPress={onFail}
        />
      </View>
    </Animated.View>
  );
}

/** Seconds before the done screen returns home on its own (partner S-3). */
export const DONE_AUTO_HOME_SEC = 4;

/**
 * End of a job (P-06, P-39, partner S-3, redesign d3/d4): «تسلم إيدك» — the check lands inside the ring
 * of today's jobs with one soft «tink», what he earned counts up, then the day so far. No cash warning
 * here (b6): where his cash stands waits for home, where the same meter lives. Only "الخردة علينا"
 * stays, as one green line, because it happened at this door. It counts down home in 4 s («نرجعك
 * للطلبات…») with a "خليني هنا" escape.
 *
 * `ask` is the rare «انت بمنطقة X؟» card (maps program SP3); `hold` stops the count home while it is
 * being read or waits for his tap, so the question is never whisked away mid-thought.
 */
export function DonePanel({
  earnedIqd,
  failed,
  onHome,
  changeToWalletIqd,
  today,
  guarantee = null,
  demand = null,
  ask = null,
  hold = false,
}: {
  earnedIqd: number;
  failed: boolean;
  onHome: () => void;
  /** "الخردة علينا": what went to the customer's wallet at this door (the whole note is on him). */
  changeToWalletIqd?: number | undefined;
  /** Today so far, re-read after this job: null while it is being re-read, absent = no day line. */
  today?: JobEndDay | null | undefined;
  /** G-91: the live peak shift, re-read after this job (null = no line). */
  guarantee?: GuaranteeWindowView | null;
  demand?: JobEndDemand | null;
  /** A question to show above the buttons (the zone check card), or null. */
  ask?: ReactNode;
  /** True holds the auto-return home (the zone question is loading or open). */
  hold?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const autoHome = !failed;
  const [stay, setStay] = useState(false);
  const [left, setLeft] = useState(DONE_AUTO_HOME_SEC);
  const counting = autoHome && !stay && !hold;
  const home = useRef(onHome);
  home.current = onHome;
  // d3: one soft bell as the check lands (never on a failed job).
  useEffect(() => {
    if (failed) return;
    const id = setTimeout(playDoneTink, theme.reduceMotion ? 0 : 250);
    return () => clearTimeout(id);
  }, [failed, theme.reduceMotion]);
  useEffect(() => {
    if (!counting) return;
    if (left <= 0) {
      home.current();
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [counting, left]);
  return (
    <JobEndFrame testID="job-done">
      <JobEndHero earnedIqd={earnedIqd} failed={failed} today={today} guarantee={guarantee}>
        <Animated.View
          entering={theme.reduceMotion ? undefined : ZoomIn.springify().damping(12)}
          style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: failed ? theme.colors.surfaceSunken : theme.colors.success, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={failed ? 'clock' : 'check'} size={56} color={failed ? 'textMuted' : 'surface'} strokeWidth={2.6} />
        </Animated.View>
      </JobEndHero>
      {changeToWalletIqd ? (
        <Animated.View
          entering={theme.reduceMotion ? undefined : FadeIn.delay(900).duration(300)}
          testID="done-wallet-change"
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], alignSelf: 'center', paddingHorizontal: theme.space[4], minHeight: 44, borderRadius: 999, backgroundColor: theme.colors.successTint }}
        >
          <Icon name="wallet" size={18} color="successText" strokeWidth={2.2} />
          <Text variant="label" weight={600} color="successText" tabular>
            {t('cashchange.done_wallet', { amount: amountParam(changeToWalletIqd) })}
          </Text>
        </Animated.View>
      ) : null}
      {autoHome ? <JobEndNext demand={demand} /> : null}
      {ask}
      <View style={{ gap: theme.space[2] }}>
        <Button testID="job-done-home" label={t('partner.job_done_cta')} size="lg" fullWidth onPress={onHome} />
        {counting ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
            <Text variant="footnote" color="textMuted" tabular testID="done-countdown" accessibilityLiveRegion="polite">
              {t('partner.done_auto_home', { n: left })}
            </Text>
            <Button testID="done-stay" label={t('partner.done_stay')} size="sm" variant="ghost" onPress={() => setStay(true)} />
          </View>
        ) : null}
      </View>
    </JobEndFrame>
  );
}
