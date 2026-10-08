import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { CHANGE_RULES, tenderOptions } from '@driver/contracts';
import { formatClock, formatMinuteCount } from '@driver/i18n';
import { Button, Card, ChangeToWallet, ChipGroup, EmptyState, Icon, ListRow, ModalSheet, Rule, SegmentedControl, Skeleton, Text, TextField, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { GiftChoice } from '@/features/gift/GiftChoice';
import { dinnerLine } from '@/features/ride-habits/logic';
import { iftarLeadMinutes } from '@/features/season/ramadan';
import { promiseCopy } from '@/features/track/late-promise';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { formatPhoneInput } from '@/lib/phone';
import { zoneName } from '@/lib/profile';
import { TABLE, type CartLine } from './cart';
import { clock12 } from './checkout';
import { etaClockAt, payCopy, payerOf, paymentOf, receiverHint, type Payer } from './checkout-lines';
import { changeNote, quickSlots, slipDishes, type CheckoutStep } from './checkout-slip';
import { EarnPill } from './EarnPill';
import { priceItems } from './price-lines';
import { SlipLine } from './SlipLine';
import { useCheckout, type CheckoutModel } from './use-checkout';

/** The street hand-over saving shown on its card (the server's rule; the quote carries the real figure). */
const STREET_SAVING_IQD = 250;

/**
 * Checkout v2 (after-order design c1 c2 c3 c4 c5 c7 c9 c12), behind the `checkout_v2` switch:
 * 1. «وين وشوكت» and «شلون تدفع»: the place with its sketch and landmark, door or street as two soft
 *    cards, when as chips, how you pay (cash with the note you'll pay with, the wallet, the household).
 * 2. «الوصل»: a paper slip with every dish and who it's for, every fee with «ليش؟», savings in
 *    saffron, the total, the note and its change, then «أكّد الطلب».
 * Both steps share one state (`useCheckout`), so Android back from the slip returns to step 1 with
 * everything kept, and a retry re-sends the same idempotency key (one order, however many taps).
 */
export function CheckoutFlow() {
  const t = useT();
  const m = useCheckout();
  const navigation = useNavigation();
  const [step, setStep] = useState<CheckoutStep>(1);
  const hasBasket = Boolean(m.merchant && m.cart.lines.length > 0);

  // Back (header, Android, the iOS swipe) from the slip goes to step 1; placing (a replace) and an
  // emptied basket pass through.
  usePreventRemove(step === 2 && hasBasket, ({ data }) => {
    if (data.action.type === 'GO_BACK' || data.action.type === 'POP') setStep(1);
    else navigation.dispatch(data.action);
  });
  useEffect(() => {
    navigation.setOptions({ title: step === 1 ? t('checkout.title') : t('checkout2.slip_title') });
  }, [navigation, step, t]);

  if (!hasBasket) {
    return (
      <>
        <Screen edges={['bottom']} testID="checkout">
          <EmptyState icon="cart" title={t('cart.empty')} body={t('cart.empty_hint')} action={{ label: t('shell.back_home'), onPress: () => (router.canDismiss() ? router.dismissAll() : router.replace('/')) }} />
        </Screen>
        <PriceChangeSheet m={m} />
      </>
    );
  }

  return (
    <>
      {step === 1 ? <StepWhereWhenPay m={m} onNext={() => setStep(2)} /> : <StepSlip m={m} onEdit={() => setStep(1)} />}
      <PriceChangeSheet m={m} />
    </>
  );
}

/** «1 من 2»: two short bars, the done one in saffron. */
function StepBar({ step }: { step: CheckoutStep }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessible accessibilityLabel={t('checkout2.step_a11y', { n: step })} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID="checkout-step">
      {[1, 2].map((n) => (
        <View key={n} style={{ height: 6, width: 28, borderRadius: 3, backgroundColor: n <= step ? theme.colors.accent : theme.colors.border }} />
      ))}
      <Text variant="caption" color="textMuted" tabular>
        {t('checkout2.step', { n: step })}
      </Text>
    </View>
  );
}

/** The footer's one line: a problem in red, a blocker or a lost answer in warning colours. */
function Notice({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const notice = m.blocker ?? (m.lostAnswer ? t('checkout.lost_answer') : null);
  if (!m.problem && !notice) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} testID="checkout-problem" accessibilityLiveRegion="polite">
      <Icon name={m.problem ? 'x' : 'clock'} size={18} color={m.problem ? 'dangerText' : 'warningText'} />
      <Text variant="footnote" color={m.problem ? 'dangerText' : 'warningText'} style={{ flex: 1 }}>
        {m.problem ?? notice}
      </Text>
    </View>
  );
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────────────────────────

function StepWhereWhenPay({ m, onNext }: { m: CheckoutModel; onNext: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [receiverOpen, setReceiverOpen] = useState(m.recipientId !== 'me');
  const [notes, setNotes] = useState({ kitchen: Boolean(m.kitchenNote), courier: Boolean(m.courierNote) });

  const next = () => {
    if (!m.checkRecipient()) {
      setReceiverOpen(true);
      return;
    }
    m.setProblem(null);
    onNext();
  };

  const footer = (
    <View style={{ gap: theme.space[2] }}>
      <Notice m={m} />
      <Button testID="checkout-next" size="lg" fullWidth label={t('checkout2.see_slip')} icon="receipt" disabled={!m.totals} onPress={next} />
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="checkout">
      <StepBar step={1} />

      <Section title={t('checkout2.where_when')}>
        <Card elevation={0} padding={0}>
          <PlaceRow m={m} />
          <View style={{ padding: theme.space[4], paddingTop: theme.space[2], gap: theme.space[3] }}>
            <DoorOrStreet m={m} />
            <WhenChips m={m} />
          </View>
        </Card>
      </Section>

      <Section title={t('checkout2.pay_title')}>
        <PayCard m={m} />
      </Section>

      <Card elevation={0} padding={0}>
        <ReceiverRow m={m} open={receiverOpen} onToggle={() => setReceiverOpen((o) => !o)} />
      </Card>

      <View style={{ gap: theme.space[2] }}>
        {notes.kitchen ? (
          <TextField testID="checkout-note-kitchen" label={t('checkout.note_kitchen')} placeholder={t('checkout.note_kitchen_placeholder')} value={m.kitchenNote} onChangeText={m.setKitchenNote} maxLength={500} multiline />
        ) : (
          <NoteLink testID="checkout-add-note-kitchen" label={t('checkout.note_kitchen')} onPress={() => setNotes((n) => ({ ...n, kitchen: true }))} />
        )}
        {notes.courier ? (
          <TextField testID="checkout-note-courier" label={t('checkout.note_courier')} placeholder={t('checkout.note_courier_placeholder')} value={m.courierNote} onChangeText={m.setCourierNote} maxLength={300} multiline />
        ) : (
          <NoteLink testID="checkout-add-note-courier" label={t('checkout.note_courier')} onPress={() => setNotes((n) => ({ ...n, courier: true }))} />
        )}
      </View>
    </Screen>
  );
}

/** c2: the saved place with a small sketch square and its landmark; «غيّر» opens the places. */
function PlaceRow({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const p = m.place;
  const title = p ? `${p.title ?? t(placeLabelKey(p.label))} · ${zoneName(p.zoneId, locale)}` : t('home.deliver_to_none');
  return (
    <Pressable
      testID="deliver-to"
      accessibilityRole="button"
      accessibilityLabel={t('checkout.row_change_a11y', { what: t('checkout.deliver_to'), value: title })}
      onPress={() => router.push('/places')}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], opacity: pressed ? 0.85 : 1 })}
    >
      <PlaceSketch home={p?.label === 'home'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={2}>
          {p?.note ?? t('checkout.change_place')}
        </Text>
      </View>
      <Text variant="label" weight={600} color="accentText">
        {t('checkout.row_change')}
      </Text>
    </Pressable>
  );
}

/**
 * The zone sketch square (c2): a few streets and the place's pin, drawn, never a photo. It becomes a
 * real street map when phones get one (the map session's square).
 */
function PlaceSketch({ home }: { home: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View style={{ width: 64, height: 64, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: c.surfaceSunken }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={64} height={64} viewBox="0 0 64 64">
        <Path d="M-4 40 L68 30" stroke={c.surface} strokeWidth={7} />
        <Path d="M22 -4 L30 68" stroke={c.surface} strokeWidth={5} />
        <Path d="M46 -4 L52 68" stroke={c.surface} strokeWidth={3} />
        <Rect x={34} y={8} width={9} height={14} rx={2} fill={c.border} />
        <Rect x={6} y={46} width={11} height={10} rx={2} fill={c.border} />
        <Circle cx={36} cy={44} r={9} fill={c.accentTint} />
        <Path d="M36 22 C30 22 26 26.5 26 32 C26 39 36 46 36 46 C36 46 46 39 46 32 C46 26.5 42 22 36 22 Z" fill={c.inverse} />
        <Circle cx={36} cy={32} r={home ? 4 : 3.5} fill={c.accent} />
      </Svg>
    </View>
  );
}

/** c3: door or street as two equal soft cards; the street saving in saffron. Follows D-8 at merge. */
function DoorOrStreet({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const card = (id: 'door' | 'street', title: string, sub: string, saffron: boolean) => {
    const on = (id === 'street') === m.street;
    return (
      <Pressable
        key={id}
        testID={`checkout-pickup-${id}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        aria-checked={on}
        accessibilityLabel={`${title}، ${sub}`}
        onPress={() => {
          if (on) return;
          theme.haptic('selection');
          m.setStreet(id === 'street');
        }}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 64,
          justifyContent: 'center',
          gap: 2,
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.lg,
          borderWidth: on ? 2 : 1,
          borderColor: on ? theme.colors.accent : theme.colors.border,
          backgroundColor: on ? theme.colors.accentTint : theme.colors.surface,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="footnote" color={saffron ? 'accentText' : 'textMuted'} weight={saffron ? 600 : 400}>
          {sub}
        </Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('checkout.pickup_mode')} style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {card('door', t('checkout.pickup_door'), t('checkout2.door_sub'), false)}
      {card('street', t('checkout2.street'), t('checkout2.street_save', { amount: amountParam(STREET_SAVING_IQD) }), true)}
    </View>
  );
}

/** c9: «هسة · 5:44» and the next two times as chips; «وقت ثاني» opens the day and every slot. */
function WhenChips({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const open = m.restaurant?.open ?? true;
  const etaMax = m.restaurant?.etaMaxMinutes ?? null;
  // The quick chips are today's; after a look at tomorrow they come back with «هسة».
  const quick = m.day === 0 ? quickSlots(m.slots) : [];
  const chosenId = m.chosen ? String(m.chosen.at.getTime()) : null;
  const inQuick = m.when === 'later' && chosenId !== null && quick.some((s) => String(s.at.getTime()) === chosenId);
  const [other, setOther] = useState(m.when === 'later' && !inQuick);
  const value = m.when === 'now' ? 'now' : other || !inQuick ? 'other' : (chosenId ?? 'other');
  const slotLabel = (sl: (typeof m.slots)[number]) =>
    sl.dinner ? t(m.dinnerTime.data?.lateByMin ? 'dinner.slot_after' : 'dinner.slot', { time: clock12(sl.at) }) : sl.iftar && m.iftar ? t('checkout.when_iftar', { time: clock12(m.iftar.iftarAt) }) : clock12(sl.at);
  const items = [
    ...(open ? [{ id: 'now', icon: 'bike' as const, label: etaMax !== null ? t('checkout2.when_now', { time: formatClock(etaClockAt(new Date(), etaMax), { locale }) }) : t('checkout.when_now') }] : []),
    ...quick.map((sl) => ({ id: String(sl.at.getTime()), label: slotLabel(sl) })),
    { id: 'other', icon: 'clock' as const, label: t('checkout2.when_other') },
  ];
  const pick = (id: string | undefined) => {
    if (!id) return;
    if (id === 'now') {
      setOther(false);
      m.setWhen('now');
      m.setDay(0);
      m.setSlot(null);
    } else if (id === 'other') {
      setOther(true);
      m.setWhen('later');
    } else {
      setOther(false);
      m.setWhen('later');
      m.setSlot(id);
    }
  };
  return (
    <View style={{ gap: theme.space[2] }} testID="checkout-when">
      <Text variant="label" color="textMuted">
        {t('checkout.when')}
      </Text>
      <ChipGroup items={items} value={[value]} required onChange={(v) => pick(v[0])} accessibilityLabel={t('checkout.when')} />
      {value === 'other' && m.when === 'later' ? (
        <View style={{ gap: theme.space[2] }}>
          <SegmentedControl
            accessibilityLabel={t('checkout.day')}
            value={String(m.day)}
            onChange={(v) => {
              m.setDay(v === '1' ? 1 : 0);
              m.setSlot(null);
            }}
            options={[
              { value: '0', label: t('time.today') },
              { value: '1', label: t('time.tomorrow') },
            ]}
          />
          {m.slots.length > 0 ? (
            <ChipGroup items={m.slots.map((sl) => ({ id: String(sl.at.getTime()), ...(sl.dinner ? { icon: 'food' as const } : {}), label: slotLabel(sl) }))} value={chosenId ? [chosenId] : []} required onChange={(v) => m.setSlot(v[0] ?? null)} accessibilityLabel={t('checkout.when')} />
          ) : (
            <Text variant="footnote" color="textMuted" testID="checkout-no-slots">
              {t('checkout.no_slots_day')}
            </Text>
          )}
        </View>
      ) : null}
      {m.chosen?.dinner && m.scheduledFor && m.dinnerTime.data ? (
        <Text variant="footnote" color="textMuted" testID="checkout-dinner-note">
          {(() => {
            const l = dinnerLine(m.dinnerTime.data.lateByMin);
            return l.key === 'with' ? t('dinner.with', { place: m.dinnerTime.data.place.name, time: clock12(m.dinnerTime.data.arriveAt) }) : t('dinner.after', { minutes: formatMinuteCount(l.minutes, { locale }), time: clock12(m.dinnerTime.data.arriveAt) });
          })()}
        </Text>
      ) : null}
      {m.chosen?.iftar && m.scheduledFor && m.iftar && m.timetable ? (
        <Text testID="checkout-iftar-note" variant="footnote" color="textMuted">
          {t('checkout.iftar_note', { minutes: formatMinuteCount(iftarLeadMinutes(m.iftar), { locale }), timetable: t(m.timetable === 'sunni' ? 'season.timetable_sunni' : 'season.timetable_shia') })}
        </Text>
      ) : null}
    </View>
  );
}

/** «شلون تدفع»: cash, the wallet or the household; points; the total; c5 the note you'll pay with. */
function PayCard({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const forOther = m.recipientId !== 'me';
  const choosePayer = (payer: Payer) => {
    const next = paymentOf(payer);
    if (next === 'wallet' && !m.walletRow.usable) return;
    m.setFromHome(false);
    m.setPayment(next);
  };
  return (
    <View style={{ gap: theme.space[3] }}>
      {forOther ? (
        <View style={{ gap: theme.space[2] }} testID="checkout-payer">
          <ChipGroup
            items={[
              { id: 'them_cash', label: m.recipientName ? t('checkout.payer_them', { name: m.recipientName }) : t('checkout.payer_them_generic'), icon: 'cash' },
              { id: 'me_wallet', label: t('checkout.payer_me'), icon: 'wallet' },
            ]}
            value={[payerOf(m.payment)]}
            required
            onChange={(v) => choosePayer(v[0] === 'me_wallet' ? 'me_wallet' : 'them_cash')}
            accessibilityLabel={t('checkout.payer_title')}
          />
          {m.balance !== null && !m.walletRow.usable && m.walletRow.missingIqd > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('checkout.payer_wallet_short', { missing: amountParam(m.walletRow.missingIqd) })}
              </Text>
              <Button size="sm" variant="secondary" icon="plus" label={t('checkout.wallet_topup')} onPress={() => router.push('/topup')} testID="checkout-wallet-topup" />
            </View>
          ) : null}
          {m.recipientName ? (
            <Text variant="footnote" color="textMuted" testID="checkout-receiver-hint">
              {t(receiverHint(m.recipientName, m.payment).key, receiverHint(m.recipientName, m.payment).params)}
            </Text>
          ) : null}
        </View>
      ) : (
        <Card elevation={0} padding={0}>
          <ListRow testID="checkout-pay-cash" leading="cash" title={t('checkout.pay_cash')} subtitle={t('checkout.cash_change_hint')} selected={m.payment === 'cash'} onPress={() => m.setPayment('cash')} chevron={false} divider />
          <ListRow
            testID="checkout-pay-wallet"
            leading="wallet"
            title={t('checkout.pay_wallet')}
            subtitle={
              m.balance === null
                ? '…'
                : m.walletRow.usable || m.walletRow.missingIqd === 0
                  ? t('checkout.wallet_balance', { amount: amountParam(m.balance) })
                  : t('checkout.wallet_short', { balance: amountParam(m.balance), missing: amountParam(m.walletRow.missingIqd) })
            }
            selected={m.payment === 'wallet' && !m.fromHome}
            onPress={
              m.walletRow.usable
                ? () => {
                    m.setFromHome(false);
                    m.setPayment('wallet');
                  }
                : undefined
            }
            chevron={false}
            divider={m.home !== null}
            trailing={m.payment === 'wallet' && !m.fromHome ? undefined : m.balance !== null && !m.walletRow.usable ? <Button size="sm" variant="secondary" icon="plus" label={t('checkout.wallet_topup')} onPress={() => router.push('/topup')} testID="checkout-wallet-topup" /> : undefined}
          />
          {m.home ? (
            <ListRow
              testID="checkout-pay-household"
              leading="family"
              title={t('checkout.pay_household')}
              subtitle={[
                m.homeBalance === null ? '…' : m.homeRow.usable || m.homeRow.missingIqd === 0 ? t('checkout.household_balance', { name: m.home.name, amount: amountParam(m.homeBalance) }) : t('checkout.household_short', { amount: amountParam(m.homeBalance) }),
                m.asksPayer && m.homePayer ? t('checkout.household_ask', { payer: m.homePayer.name ?? t('household.role_payer') }) : null,
              ]
                .filter(Boolean)
                .join('\n')}
              selected={m.payment === 'wallet' && m.fromHome}
              onPress={
                m.homeRow.usable
                  ? () => {
                      m.setFromHome(true);
                      m.setPayment('wallet');
                    }
                  : undefined
              }
              chevron={false}
            />
          ) : null}
        </Card>
      )}
      {m.pointsOffer ? (
        <Card elevation={0} padding={0}>
          <ListRow
            testID="checkout-points"
            leading="gift"
            title={t('checkout.points_row', { amount: amountParam(m.pointsOffer.valueIqd) })}
            subtitle={t('checkout.points_hint', { n: amountParam(m.pointsOffer.balance) })}
            onPress={() => m.setUsePoints((v) => !v)}
            chevron={false}
            trailing={
              <Switch
                testID="checkout-points-switch"
                accessibilityLabel={t('checkout.points_row', { amount: amountParam(m.pointsOffer.valueIqd) })}
                value={m.usePoints}
                onValueChange={m.setUsePoints}
                trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
              />
            }
          />
        </Card>
      ) : null}
      <TotalLine m={m} />
      {m.payment === 'cash' && m.totals ? <PayWith totalIqd={m.totals.totalIqd} value={m.tender} onChange={m.setTenderPick} /> : null}
    </View>
  );
}

/** «المجموع 17,500 دينار» on step 1 too, so the note chips read against it. */
function TotalLine({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} testID="checkout-total-line">
      <Text variant="title" style={{ flex: 1 }}>
        {t('quote.total')}
      </Text>
      {m.totals ? (
        <Text variant="amount" face="display" tabular testID="checkout-total-amount">
          {iqd(m.totals.totalIqd, { locale })}
        </Text>
      ) : m.quote.isError ? (
        <Button size="sm" variant="secondary" label={t('action.retry')} onPress={() => void m.quote.refetch()} />
      ) : (
        <Skeleton height={24} width={120} />
      )}
    </View>
  );
}

/** c5 «راح أدفع بـ»: the server's own chips; the change line says change-or-credit, or cash above the cap. */
function PayWith({ totalIqd, value, onChange }: { totalIqd: number; value: number | null; onChange: (v: number | null) => void }) {
  const theme = useTheme();
  const t = useT();
  const options = tenderOptions(totalIqd);
  if (options.length === 0) return null;
  const note = value !== null ? changeNote(value, totalIqd) : null;
  return (
    <View testID="checkout-pay-with" style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="label" weight={600}>
          {t('cashchange.pay_with_title')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('cashchange.pay_with_hint')}
        </Text>
      </View>
      <ChipGroup
        columns={2}
        accessibilityLabel={t('cashchange.pay_with_title')}
        items={options.map((n) => ({ id: `tender-${n}`, label: n === totalIqd ? `${amountParam(n)} ${t('cashchange.pay_with_exact')}` : amountParam(n), accessibilityLabel: t('cashchange.pay_with_a11y', { amount: amountParam(n) }) }))}
        value={value !== null ? [`tender-${value}`] : []}
        onChange={(next) => onChange(next[0] ? Number(next[0].slice('tender-'.length)) : null)}
      />
      {note ? (
        <View testID="checkout-pay-with-note" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} accessibilityLiveRegion="polite">
          <Icon name={note.kind === 'exact' ? 'check' : 'cash'} size={16} color={note.kind === 'cash_only' ? 'warningText' : 'accentText'} strokeWidth={2.2} />
          <Text variant="footnote" color={note.kind === 'cash_only' ? 'warningText' : 'accentText'} tabular style={{ flex: 1 }}>
            {note.kind === 'exact'
              ? t('cashchange.pay_with_exact_note')
              : note.kind === 'change'
                ? t('checkout2.pay_with_change', { amount: amountParam(note.changeIqd) })
                : t('checkout2.change_cash_only', { amount: amountParam(note.changeIqd), cap: amountParam(CHANGE_RULES.maxIqd) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** «منو يستلم؟ أنا · غيّر»: opens the people, someone new, and the «عزيمة» gift. */
function ReceiverRow({ m, open, onToggle }: { m: CheckoutModel; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const t = useT();
  const value = m.recipientId === 'me' ? t('checkout.recipient_me') : m.recipientId === 'other' ? m.otherName.trim() || t('checkout.recipient_other') : (m.recipientName ?? t('checkout.recipient_other'));
  const items = [
    { id: 'me', label: t('checkout.recipient_me'), avatar: { name: m.myName ?? t('checkout.recipient_me'), tone: 'accent' as const } },
    ...m.cart.people.map((p) => ({ id: p.id, label: p.name, avatar: { name: p.name } })),
    ...m.savedOthers.map((p) => ({ id: `saved:${p.id}`, label: p.name, avatar: { name: p.name } })),
    { id: 'other', label: t('checkout.recipient_other'), avatar: { icon: 'user' as const, tone: 'info' as const } },
  ];
  return (
    <View>
      <Pressable
        testID="checkout-row-receiver"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('checkout.row_change_a11y', { what: t('checkout.recipient'), value })}
        onPress={onToggle}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[4], opacity: pressed ? 0.8 : 1 })}
      >
        <Icon name="user" size={18} color="textMuted" />
        <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
          <Text variant="body" color="textMuted">
            {t('checkout.recipient')}{' '}
          </Text>
          <Text variant="body" weight={600}>
            {value}
          </Text>
        </Text>
        <Text variant="label" weight={600} color="accentText">
          {t('checkout.row_change')}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
          <ChipGroup items={items} value={[m.recipientId]} required onChange={(v) => m.setRecipientId(v[0] ?? 'me')} accessibilityLabel={t('checkout.recipient')} />
          {m.recipientId === 'other' ? (
            <View style={{ gap: theme.space[2] }}>
              <TextField testID="checkout-recipient-name" value={m.otherName} onChangeText={m.setOtherName} placeholder={t('checkout.recipient_name')} error={m.fieldErrors.name} />
              <TextField testID="checkout-recipient-phone" value={m.otherPhone} onChangeText={(v) => m.setOtherPhone(formatPhoneInput(v))} placeholder={t('checkout.recipient_phone')} keyboardType="phone-pad" error={m.fieldErrors.phone} />
            </View>
          ) : null}
          {m.recipientId !== 'me' ? <GiftChoice name={m.recipientName} payment={m.payment} value={m.gift} onChange={m.setGift} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function NoteLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
      <Icon name="plus" size={16} color="accentText" strokeWidth={2.4} />
      <Text variant="label" weight={600} color="accentText">
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// ─── Step 2: «الوصل» ─────────────────────────────────────────────────────────────────────────────

function StepSlip({ m, onEdit }: { m: CheckoutModel; onEdit: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const totals = m.totals;
  const restaurant = m.restaurant;
  const groupLabel = (line: CartLine) => {
    if (!m.grouped) return null;
    if (line.personId === TABLE) return t('cart.for_table_section');
    return m.cart.people.find((p) => p.id === line.personId)?.name ?? t('cart.for_me_section');
  };
  const dishes = slipDishes(m.cart, groupLabel);
  const fees = totals ? priceItems(totals, t, locale).filter((i) => i.key !== 'items') : [];
  const receiver = m.recipientName ? ({ kind: 'other', name: m.recipientName } as const) : ({ kind: 'me' } as const);
  const payLine = payCopy(amountParam(totals?.totalIqd ?? 0), m.payment, receiver);
  const etaMin = restaurant?.etaMinMinutes ?? null;
  const etaMax = restaurant?.etaMaxMinutes ?? null;
  const now = new Date();
  const eta = m.scheduledFor
    ? t('checkout2.slip_eta_at', { time: clock12(m.scheduledFor) })
    : etaMin !== null && etaMax !== null
      ? t('checkout2.slip_eta', { from: formatClock(etaClockAt(now, etaMin), { locale }), to: formatClock(etaClockAt(now, etaMax), { locale }) })
      : null;
  const note = totals && m.payment === 'cash' && m.tender !== null ? changeNote(m.tender, totals.totalIqd) : null;
  const label = totals
    ? m.scheduledFor
      ? t('checkout.place_scheduled', { time: clock12(m.scheduledFor), amount: amountParam(totals.totalIqd) })
      : t('checkout.place_order', { amount: amountParam(totals.totalIqd) })
    : t('checkout.title');

  const footer = (
    <View style={{ gap: theme.space[2] }}>
      <Notice m={m} />
      <Button
        testID="checkout-place"
        size="lg"
        fullWidth
        label={label}
        loading={m.placing}
        loadingLabel={m.replaying ? t('checkout.checking') : t('checkout.placing')}
        disabled={!totals || Boolean(m.blocker)}
        haptic="success"
        onPress={() => void m.onPlace()}
        accessibilityHint={m.lostAnswer ? t('checkout.lost_answer') : undefined}
      />
      {totals ? (
        <Text variant="caption" color="textMuted" align="center" tabular testID="checkout-pay-line">
          {t(payLine.key, payLine.params)}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="checkout">
      <StepBar step={2} />
      <View testID="checkout-slip" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[3] }}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="title" face="display" accessibilityRole="header" numberOfLines={2}>
            {m.merchant?.name}
          </Text>
          {eta ? (
            <Text variant="bodyStrong" tabular testID="checkout-eta">
              {eta}
            </Text>
          ) : null}
          {m.orderQuote.data?.latePromise && !m.scheduledFor ? (
            <View testID="checkout-late-promise" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], marginTop: theme.space[1] }}>
              <View style={{ marginTop: 3 }}>
                <Icon name="shield" size={16} color="accentText" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="footnote" weight={600} color="accentText">
                  {t(promiseCopy(m.orderQuote.data.latePromise.basis).line, { minutes: m.orderQuote.data.latePromise.afterMin })}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t(promiseCopy(m.orderQuote.data.latePromise.basis).checkoutHint, { amount: amountParam(m.orderQuote.data.latePromise.creditIqd) })}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <Rule kind="dashed" color="borderStrong" thickness={1.5} />

        <View style={{ gap: theme.space[1] }} testID="checkout-slip-dishes">
          {dishes.map((d) => (
            <SlipLine key={d.key} label={`${d.qty > 1 ? `${d.name} ×${d.qty}` : d.name}${d.who ? ` · ${d.who}` : ''}`} amountIqd={d.amountIqd} testID={`slip-dish-${d.key}`} />
          ))}
        </View>

        {totals ? (
          <View style={{ gap: theme.space[1] }} testID="checkout-slip-fees">
            {fees.map((f) => (
              <SlipLine key={f.key} label={f.label} amountIqd={f.amount} reason={f.reason} testID={`slip-fee-${f.key}`} />
            ))}
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Skeleton height={16} />
            <Skeleton height={16} width="70%" />
          </View>
        )}

        <Rule kind="dashed" color="borderStrong" thickness={1.5} />

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} accessible accessibilityLabel={totals ? `${t('quote.total')} ${iqd(totals.totalIqd, { locale })}` : t('quote.total')} testID="checkout-price-total">
          <Text variant="title" style={{ flex: 1 }}>
            {t('quote.total')}
          </Text>
          {totals ? (
            <Text variant="amount" face="display" tabular testID="checkout-price-total-amount">
              {iqd(totals.totalIqd, { locale })}
            </Text>
          ) : (
            <Skeleton height={24} width={120} />
          )}
        </View>
        {totals ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            <Icon name="shield" size={16} color="textMuted" />
            <Text variant="footnote" color="textMuted">
              {t('quote.quote_locked')}
            </Text>
          </View>
        ) : null}
        {totals && totals.changeIqd > 0 ? <ChangeToWallet change={totals.changeIqd} price={totals.priceIqd} cash={totals.totalIqd} testID="checkout-price-change" /> : null}
        {totals && note && m.tender !== null ? (
          <View testID="checkout-slip-tender" style={{ backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3], gap: 2 }}>
            <Text variant="bodyStrong" tabular>
              {t('checkout2.paying_with', { amount: amountParam(m.tender) })}
            </Text>
            <Text variant="footnote" color={note.kind === 'cash_only' ? 'warningText' : 'accentText'} tabular>
              {note.kind === 'exact' ? t('cashchange.pay_with_exact_note') : note.kind === 'change' ? t('checkout2.change_or_credit', { amount: amountParam(note.changeIqd) }) : t('checkout2.change_cash_only', { amount: amountParam(note.changeIqd), cap: amountParam(CHANGE_RULES.maxIqd) })}
            </Text>
          </View>
        ) : null}
        {m.payment === 'wallet' && m.fromHome && m.asksPayer && m.homePayer ? (
          <Text variant="footnote" color="textMuted" testID="checkout-slip-household">
            {t('checkout.household_ask', { payer: m.homePayer.name ?? t('household.role_payer') })}
          </Text>
        ) : null}
        <EarnPill points={m.orderQuote.data?.pointsEarn} grouped={m.groups.length > 1} />
      </View>

      <Card elevation={0} padding={0}>
        <SummaryRow icon="map-pin" what={t('checkout.deliver_to')} text={m.place ? `${m.place.title ?? t(placeLabelKey(m.place.label))} · ${m.street ? t('checkout2.street') : t('checkout.pickup_door')}` : t('cart.pick_place')} onPress={onEdit} divider testID="slip-edit-where" />
        <SummaryRow icon="user" what={t('checkout.recipient')} text={`${t('checkout.recipient')} ${m.recipientName ?? t('checkout.recipient_me')}`} onPress={onEdit} testID="slip-edit-who" />
      </Card>
    </Screen>
  );
}

function SummaryRow({ icon, what, text, onPress, divider, testID }: { icon: 'map-pin' | 'user'; what: string; text: string; onPress: () => void; divider?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('checkout.row_change_a11y', { what, value: text })}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[4], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={18} color="textMuted" />
      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
        {text}
      </Text>
      <Text variant="label" weight={600} color="accentText">
        {t('checkout.row_change')}
      </Text>
    </Pressable>
  );
}

// ─── c12: a price or deal moved ─────────────────────────────────────────────────────────────────

/** Old and new side by side, calmly, instead of a red error; the slip underneath already shows the new figures. */
function PriceChangeSheet({ m }: { m: CheckoutModel }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const c = m.change;
  const empty = m.cart.lines.length === 0;
  const close = () => {
    m.clearChange();
    if (empty) router.back();
  };
  return (
    <ModalSheet
      visible={c !== null}
      onClose={close}
      title={t('checkout2.change_title')}
      subtitle={c?.reason === 'deal' ? t('checkout2.change_deal') : t('checkout2.change_price')}
      testID="checkout-change-sheet"
      footer={<Button testID="checkout-change-ok" size="lg" fullWidth label={empty ? t('checkout2.change_back') : t('checkout2.change_ok')} onPress={close} />}
    >
      <View style={{ gap: theme.space[2] }}>
        {c?.rows.map((r) => (
          <View key={r.key} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} testID={`change-row-${r.key}`}>
            <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
              {r.name}
            </Text>
            <Text variant="footnote" color="textMuted" tabular style={{ textDecorationLine: 'line-through' }}>
              {amountParam(r.oldIqd)}
            </Text>
            <Icon name="arrow-forward" size={14} color="textMuted" />
            <Text variant="bodyStrong" color={r.newIqd === null ? 'warningText' : 'text'} tabular>
              {r.newIqd === null ? t('checkout2.gone') : amountParam(r.newIqd)}
            </Text>
          </View>
        ))}
        {c && c.oldTotalIqd !== null && m.totals ? (
          <>
            <Rule kind="dashed" color="borderStrong" thickness={1.5} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} testID="change-total">
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t('quote.total')}
              </Text>
              <Text variant="footnote" color="textMuted" tabular style={{ textDecorationLine: 'line-through' }}>
                {amountParam(c.oldTotalIqd)}
              </Text>
              <Icon name="arrow-forward" size={14} color="textMuted" />
              <Text variant="bodyStrong" tabular>
                {iqd(m.totals.totalIqd, { locale })}
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </ModalSheet>
  );
}

