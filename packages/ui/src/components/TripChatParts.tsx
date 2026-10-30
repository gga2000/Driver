import { View } from 'react-native';
import type { TripChatCard, TripDealItem } from '@driver/contracts';
import { formatAmount, formatClock, formatIqd } from '../format';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import type { ChatT } from './ChatThread';
import { StatusPill, type StatusTone } from './StatusPill';
import { Text } from './Text';

/** Whose app draws it: the rider's (customer) or the driver's (courier). */
export type TripChatSide = 'customer' | 'courier';

const ICON: Record<TripChatCard['kind'], IconName> = { pin_pickup: 'map-pin', door_drop: 'home', cash_reservation: 'cash' };

/** «الصعود من دبوسك» / «… دبوسه»: what a price is for, as the reader says it. */
export function tripCardTitle(t: ChatT, kind: TripChatCard['kind'], side: TripChatSide): string {
  const who = side === 'customer' ? 'you' : 'them';
  if (kind === 'pin_pickup') return t(`chat.trip.card.pin_${who}`);
  if (kind === 'door_drop') return t(`chat.trip.card.door_${who}`);
  return t(`chat.trip.card.cash_${who}`);
}

/** A price as both apps say it: «2,000 دينار» or «ببلاش». */
export function tripPrice(t: ChatT, amountIqd: number): string {
  return amountIqd === 0 ? t('chat.trip.card.free') : formatIqd(amountIqd);
}

/** Who has to answer a card now: the reader (show the buttons), the other side, or nobody. */
export function tripCardTurn(card: TripChatCard, side: TripChatSide): 'you' | 'them' | null {
  if (card.state === 'asked') return side === 'courier' ? 'you' : 'them';
  if (card.state === 'proposed' && card.stage === 'price') return side === 'customer' ? 'you' : 'them';
  return null;
}

/**
 * An agreed-price card in the Baghdad/Kut chat (step 4c, Ali's design way 2): what it is for, the
 * amount, the reason (how far the pin is), and its state now. Whoever's turn it is gets the buttons:
 * the rider «موافق / لا» on a driver's price, the driver «اقترح سعر» on an ask, or «موافق / لا» on a
 * «احجز وادفع كاش» ask. The amounts come from the server; the app never adds them up.
 */
export function TripCard({
  card,
  side,
  mine,
  otherName,
  t,
  busy,
  onAnswer,
  onPrice,
  testID,
}: {
  card: TripChatCard;
  side: TripChatSide;
  /** The reader wrote it (his ask, or his price). */
  mine: boolean;
  /** The other side's first name, or the role. */
  otherName: string;
  t: ChatT;
  /** An answer is on its way: `true` = موافق, `false` = لا. */
  busy?: boolean | null;
  onAnswer?: (accept: boolean) => void;
  /** The driver prices an ask from here. */
  onPrice?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const turn = tripCardTurn(card, side);
  const done = card.state === 'replaced' || card.state === 'declined' || card.state === 'expired' || card.state === 'withdrawn';
  const head = card.stage === 'ask' ? t(mine ? 'chat.trip.card.asked_you' : 'chat.trip.card.asked_them', { name: otherName }) : t(mine ? 'chat.trip.card.proposed_you' : 'chat.trip.card.proposed_them', { name: otherName });
  const cash = card.kind === 'cash_reservation';
  const amount = card.amountIqd;
  const detail = cash
    ? amount !== null
      ? t(side === 'customer' ? 'chat.trip.card.cash_rule_you' : 'chat.trip.card.cash_rule_them', { amount: formatAmount(amount) })
      : null
    : card.note;
  const km = !cash && card.distanceKm !== null ? t('chat.trip.card.km', { km: formatAmount(Math.round(card.distanceKm)) }) : null;
  const showAmount = !cash && card.stage === 'price' && amount !== null;
  return (
    <View
      testID={testID}
      style={{
        gap: theme.space[2],
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: turn === 'you' ? theme.colors.accent : theme.colors.border,
        backgroundColor: done ? theme.colors.surfaceSunken : theme.colors.surface,
        opacity: card.state === 'replaced' ? 0.72 : 1,
      }}
    >
      <Text variant="caption" color="textMuted" weight={600}>
        {head}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? theme.colors.surface : theme.colors.accentTint }}>
          <Icon name={ICON[card.kind]} size={20} color={done ? 'textMuted' : 'accentText'} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 0 }}>
          <Text variant="label" weight={700} numberOfLines={2}>
            {tripCardTitle(t, card.kind, side)}
          </Text>
          {detail ? (
            <Text variant="caption" color="textMuted" numberOfLines={3} tabular>
              {detail}
            </Text>
          ) : null}
          {km ? (
            <Text variant="caption" color="textMuted" tabular>
              {km}
            </Text>
          ) : null}
        </View>
        {showAmount ? (
          <Text variant="title" weight={700} tabular style={card.state === 'replaced' ? { textDecorationLine: 'line-through' } : undefined} testID={testID ? `${testID}-amount` : undefined}>
            {tripPrice(t, amount)}
          </Text>
        ) : null}
      </View>
      {turn === 'you' && side === 'courier' && !cash && onPrice ? (
        <Button testID={testID ? `${testID}-price` : undefined} label={t('chat.trip.price_cta')} icon="cash" size="sm" fullWidth onPress={onPrice} />
      ) : turn === 'you' && onAnswer ? (
        <View style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <View style={{ flex: 2 }}>
              <Button testID={testID ? `${testID}-yes` : undefined} label={t('chat.trip.accept')} icon="check" size="sm" fullWidth loading={busy === true} disabled={busy === false} onPress={() => onAnswer(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID={testID ? `${testID}-no` : undefined} label={t('chat.trip.decline')} variant="secondary" size="sm" fullWidth loading={busy === false} disabled={busy === true} onPress={() => onAnswer(false)} />
            </View>
          </View>
          {card.expiresAt ? (
            <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
              {t('chat.trip.card.expires', { time: formatClock(card.expiresAt) })}
            </Text>
          ) : null}
        </View>
      ) : (
        <CardState card={card} side={side} t={t} testID={testID ? `${testID}-state` : undefined} />
      )}
    </View>
  );
}

function CardState({ card, side, t, testID }: { card: TripChatCard; side: TripChatSide; t: ChatT; testID?: string | undefined }) {
  const s = card.state;
  let tone: StatusTone = 'neutral';
  let icon: IconName = 'clock';
  let label: string;
  if (s === 'asked' || (s === 'proposed' && card.stage === 'price')) {
    // Waiting on the other side.
    tone = 'info';
    label = t(side === 'customer' ? 'chat.trip.state.wait_driver' : 'chat.trip.state.wait_rider');
  } else if (s === 'proposed') {
    tone = 'info';
    icon = 'send';
    label = t('chat.trip.state.priced');
  } else if (s === 'accepted') {
    tone = 'success';
    icon = 'check';
    label = t('chat.trip.state.accepted');
  } else if (s === 'used') {
    tone = 'success';
    icon = 'lock';
    label = t('chat.trip.state.used');
  } else {
    icon = s === 'replaced' ? 'swap' : 'x';
    label = t(`chat.trip.state.${s}`);
  }
  return <StatusPill size="sm" tone={tone} icon={icon} label={label} testID={testID} />;
}

/**
 * The pinned «اللي اتفقنا عليه» strip (Ali's design way 2): every live price between the two, agreed
 * or waiting, so nobody scrolls back to find it. A price locked on the booking shows the lock.
 */
export function TripDealStrip({ deal, side, t, testID = 'trip-deal' }: { deal: readonly TripDealItem[]; side: TripChatSide; t: ChatT; testID?: string }) {
  const theme = useTheme();
  if (deal.length === 0) return null;
  return (
    <View testID={testID} style={{ gap: theme.space[1] }} accessibilityRole="summary">
      <Text variant="caption" color="textMuted" weight={700}>
        {t('chat.trip.deal_title')}
      </Text>
      {deal.map((d) => {
        const waitingOnYou = (d.state === 'asked' && side === 'courier') || (d.state === 'proposed' && side === 'customer');
        const state =
          d.state === 'agreed'
            ? t(d.locked ? 'chat.trip.deal.locked' : 'chat.trip.deal.agreed')
            : waitingOnYou
              ? t('chat.trip.deal.wait_you')
              : t(side === 'customer' ? 'chat.trip.deal.wait_driver' : 'chat.trip.deal.wait_rider');
        const tone = d.state === 'agreed' ? 'successText' : waitingOnYou ? 'accentText' : 'infoText';
        return (
          <View key={d.refId} testID={`${testID}-${d.kind}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 28 }}>
            <Icon name={d.state === 'agreed' ? (d.locked ? 'lock' : 'check') : 'clock'} size={15} color={tone} strokeWidth={2.2} />
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {tripCardTitle(t, d.kind, side)}
            </Text>
            {d.amountIqd !== null && d.kind !== 'cash_reservation' ? (
              <Text variant="label" weight={700} tabular>
                {tripPrice(t, d.amountIqd)}
              </Text>
            ) : null}
            <Text variant="caption" weight={600} color={tone}>
              {state}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
