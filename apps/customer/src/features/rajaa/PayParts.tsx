import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { SeatPayment } from '@driver/contracts';
import { Button, Icon, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * How to pay for a seat (Baghdad/Kut ideas p2, p3, Ali 2026-10-07): cash and wallet side by side,
 * three rules each with its icon, the wallet marked «الأضمن»; the balance and «اشحن» right under.
 * Cash stays the default. The amounts and rules are the server's (RAJAA_RULES); nothing is priced here.
 */

type Rule = { icon: IconName; text: string };

function PayCard({ kind, title, icon, rules, selected, safest, onPress }: { kind: SeatPayment; title: string; icon: IconName; rules: readonly Rule[]; selected: boolean; safest?: string; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={`pay-${kind}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={t('rajaa.pay_compare_a11y', { title: safest ? `${title} · ${safest}` : title, rules: rules.map((r) => r.text).join('. ') })}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        padding: theme.space[3],
        gap: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      {/* «الأضمن» sits on the card's top edge, so both cards keep the same rows. */}
      {safest ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: -13, end: theme.space[3] }}>
          <StatusPill label={safest} tone="success" icon="shield" size="sm" style={{ borderWidth: 1, borderColor: theme.colors.surface }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[1] }}>
        <Icon name={icon} size={20} color={selected ? 'accentText' : 'text'} strokeWidth={2} />
        <Text variant="label" weight={700} style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={{ gap: theme.space[2] }}>
        {rules.map((r) => (
          <View key={r.text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Icon name={r.icon} size={16} color="textMuted" strokeWidth={2} style={{ marginTop: 2 }} />
            <Text variant="caption" color="text" style={{ flex: 1 }}>
              {r.text}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/** How much the wallet lacks for this seat (0 when it covers it, or while the balance is unknown). */
export function walletShortBy(balanceIqd: number | null, totalIqd: number): number {
  return balanceIqd !== null && balanceIqd < totalIqd ? totalIqd - Math.max(0, balanceIqd) : 0;
}

export function PayCompare({
  value,
  onChange,
  cancelUntil,
  totalIqd,
  balanceIqd,
}: {
  value: SeatPayment;
  onChange: (p: SeatPayment) => void;
  /** «تلغي ببلاش لحد 6:20 ص»: when boarding opens (wallet). */
  cancelUntil: string;
  totalIqd: number;
  /** Null while the balance loads (or when signed out). */
  balanceIqd: number | null;
}) {
  const theme = useTheme();
  const t = useT();
  const short = walletShortBy(balanceIqd, totalIqd);
  // The shortfall is a warning only once the wallet is the choice; with cash it is just information.
  const warn = short > 0 && value === 'wallet';
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', gap: theme.space[2], paddingTop: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.pay_title')}>
        <PayCard
          kind="cash"
          icon="cash"
          title={t('rajaa.pay_cash')}
          selected={value === 'cash'}
          onPress={() => onChange('cash')}
          rules={[
            { icon: 'cash', text: t('rajaa.cash_short_1') },
            { icon: 'clock', text: t('rajaa.cash_short_2') },
            { icon: 'x', text: t('rajaa.cash_short_3') },
          ]}
        />
        <PayCard
          kind="wallet"
          icon="wallet"
          title={t('rajaa.pay_wallet')}
          safest={t('rajaa.pay_safest')}
          selected={value === 'wallet'}
          onPress={() => onChange('wallet')}
          rules={[
            { icon: 'shield', text: t('rajaa.wallet_short_1') },
            { icon: 'clock', text: t('rajaa.wallet_short_2') },
            { icon: 'x', text: t('rajaa.wallet_short_3', { time: cancelUntil }) },
          ]}
        />
      </View>
      {balanceIqd !== null ? (
        <View testID="rajaa-wallet-balance" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44 }}>
          <Icon name="wallet" size={16} color={warn ? 'warningText' : 'textMuted'} />
          <Text variant="footnote" color={warn ? 'warningText' : 'textMuted'} style={{ flex: 1 }} tabular>
            {short > 0
              ? t('rajaa.wallet_short_of', { balance: amountParam(Math.max(0, balanceIqd)), missing: amountParam(short) })
              : t('rajaa.wallet_balance', { amount: amountParam(balanceIqd) })}
          </Text>
          <Button testID="rajaa-wallet-topup" size="sm" variant="secondary" icon="plus" label={t('rajaa.wallet_topup')} onPress={() => router.push('/topup')} />
        </View>
      ) : null}
      {value === 'cash' ? (
        <Text variant="caption" color="textMuted">
          {t('rajaa.cash_rule_4')}
        </Text>
      ) : null}
    </View>
  );
}
