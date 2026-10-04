import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { formatAmount } from '../format';
import { Icon } from '../icons/Icon';
import { summarizePrice, type PriceItem } from '../logic/price';
import { useCountUp } from '../motion/useCountUp';
import { useTheme } from '../theme/ThemeProvider';
import { Rule } from './Rule';
import { Text } from './Text';

export interface PriceLineProps {
  label: string;
  amount: number;
  reason?: string;
  /** Computed, not charged: muted, struck through, with the shadow hint. */
  shadow?: boolean;
  /** Bold row (subtotal). */
  strong?: boolean;
  /** A small, muted row (the "تقريب" rounding line): part of the sum, not a price component. */
  minor?: boolean;
  testID?: string;
}

/** One named price component. Negative amounts (discounts, points) read in the success colour. */
export function PriceLine({ label, amount, reason, shadow, strong, minor, testID }: PriceLineProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const discount = amount < 0 && !shadow && !minor;
  const amountColor = shadow || minor ? 'textMuted' : discount ? 'successText' : 'text';
  const variant = minor ? 'caption' : strong ? 'bodyStrong' : 'body';
  const row = (
    <View testID={testID} style={{ gap: 2, paddingVertical: minor ? 0 : theme.space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text variant={variant} color={shadow || minor ? 'textMuted' : 'text'} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        {reason ? (
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }], alignSelf: 'center' }}>
            <Icon name="chevron-down" size={14} color="textMuted" strokeWidth={2} />
          </View>
        ) : null}
        {/* Dotted leader: ties a label to its amount across a wide row, like a printed receipt. */}
        <Rule kind="dotted" color="borderStrong" thickness={1.5} style={{ flex: 1, minWidth: theme.space[3], alignSelf: 'center', marginTop: 8 }} />
        <Text
          variant={variant}
          weight={strong || discount ? 600 : 400}
          color={amountColor}
          tabular
          testID={testID ? `${testID}-amount` : undefined}
          style={shadow ? { textDecorationLine: 'line-through' } : null}
        >
          {formatAmount(amount)}
        </Text>
      </View>
      {shadow ? (
        <Text variant="caption" color="textMuted">
          {t('quote.shadow_hint')}
        </Text>
      ) : null}
      {reason && open ? (
        <Text variant="footnote" color="textMuted">
          {reason}
        </Text>
      ) : null}
    </View>
  );
  if (!reason) return row;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${formatAmount(amount)}`}
      accessibilityHint={t('checkout.why_this_fee')}
      aria-expanded={open}
      onPress={() => setOpen((o) => !o)}
    >
      {row}
    </Pressable>
  );
}

export interface PriceBreakdownProps {
  items: readonly PriceItem[];
  /** Server total (rounded/bounded). Omit to round the subtotal to `step`. */
  total?: number;
  step?: number;
  /** Show shadow (metered, not charged) lines — partner and console views. */
  showShadow?: boolean;
  totalLabel?: string;
  /** e.g. "السعر مثبّت، ما يتغير" under the total. */
  note?: string;
  /**
   * Cash change inside `total` (Ali, 2026-10-04: cash rounds up to 250, the remainder is credited to the
   * customer's wallet). Shown under the total as "الباقي رصيد +200" with what it means; never as a
   * line that raises the price.
   */
  change?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PriceBreakdown({ items, total, step, showShadow = false, totalLabel, note, change, style, testID = 'price' }: PriceBreakdownProps) {
  const theme = useTheme();
  const s = summarizePrice(items, { total, step, change });
  const counted = useCountUp(s.total);
  return (
    <View testID={testID} style={[{ gap: theme.space[1] }, style]}>
      {s.shown.map((i) => (
        <PriceLine key={i.key} testID={`${testID}-line-${i.key}`} label={i.label} amount={i.amount} reason={i.reason} />
      ))}
      {s.rounding !== 0 ? (
        <PriceLine testID={`${testID}-rounding`} label={t('quote.rounding')} amount={s.rounding} minor />
      ) : null}
      {showShadow
        ? s.shadow.map((i) => (
            <PriceLine key={i.key} testID={`${testID}-shadow-${i.key}`} label={i.label} amount={i.amount} reason={i.reason} shadow />
          ))
        : null}
      {/* Perforation: the total sits under a dashed tear line, the one receipt cue in the system. */}
      <Rule kind="dashed" color="borderStrong" thickness={1.5} style={{ marginTop: theme.space[2], marginBottom: theme.space[1] }} />
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
        accessible
        accessibilityLabel={`${totalLabel ?? t('quote.total')} ${formatAmount(s.total)} ${t('quote.currency')}`}
        testID={`${testID}-total`}
      >
        <Text variant="title">{totalLabel ?? t('quote.total')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1] }}>
          <Text variant="amount" tabular testID={`${testID}-total-amount`}>
            {formatAmount(counted)}
          </Text>
          <Text variant="label" color="textMuted">
            {t('quote.currency')}
          </Text>
        </View>
      </View>
      {s.change > 0 ? <ChangeToWallet change={s.change} price={s.total - s.change} cash={s.total} testID={`${testID}-change`} /> : null}
      {note ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
          <Icon name="shield" size={16} color="successText" />
          <Text variant="footnote" color="successText">
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * "الباقي رصيد": the cash change in a total, credited to the customer's wallet (customer d-1, C-07).
 * A success-tinted strip under the total — the remainder is his, not a charge.
 */
export function ChangeToWallet({ change, price, cash, testID }: { change: number; price: number; cash: number; testID?: string }) {
  const theme = useTheme();
  const hint = t('quote.change_to_wallet_hint', { price: formatAmount(price), cash: formatAmount(cash), amount: formatAmount(change) });
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${t('quote.change_to_wallet')} ${formatAmount(change)} ${t('quote.currency')}. ${hint}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.md, paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], marginTop: theme.space[1] }}
    >
      <View style={{ marginTop: 2 }}>
        <Icon name="wallet" size={18} color="successText" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
          <Text variant="label" weight={600} color="successText">
            {t('quote.change_to_wallet')}
          </Text>
          <Text variant="label" weight={700} color="successText" tabular testID={testID ? `${testID}-amount` : undefined}>
            {formatAmount(change, { sign: true })}
          </Text>
        </View>
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      </View>
    </View>
  );
}
