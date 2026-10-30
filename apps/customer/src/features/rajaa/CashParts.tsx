import { View } from 'react-native';
import { Button, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { AskRow } from './AgreeParts';
import type { CashPhase } from './cash';
import { RuleList } from './Option';

/**
 * Step 4b a6 «احجز وادفع كاش» in the pick panel of one offer: the ask, waiting for the driver, his yes
 * (book with no deposit, the no-show amount said plainly before booking), his no, or what is owed first.
 */
export function CashPanel({
  phase,
  name,
  priceIqd,
  noShowIqd,
  owedIqd,
  asking,
  askError,
  booking,
  onAsk,
  onBook,
}: {
  phase: Exclude<CashPhase, 'none'>;
  /** The driver's first name. */
  name: string;
  priceIqd: number;
  /** The deposit amount, owed only on a no-show. */
  noShowIqd: number;
  /** What his wallet owes now (shown when `owed`). */
  owedIqd: number;
  asking: boolean;
  /** Why the ask failed (shown under it), else null. */
  askError: string | null;
  booking: boolean;
  onAsk: () => void;
  onBook: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const amount = amountParam(noShowIqd);

  if (phase === 'ask')
    return (
      <View style={{ gap: theme.space[2] }}>
        <Text variant="caption" color="textMuted">
          {t('rajaa.cash_ask_title')}
        </Text>
        <AskRow icon="cash" title={t('rajaa.cash_ask_cta', { name })} hint={t('rajaa.cash_ask_hint')} onPress={asking ? () => undefined : onAsk} testID="rajaa-cash-ask" />
        {askError ? (
          <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite" testID="rajaa-cash-error">
            {askError}
          </Text>
        ) : null}
      </View>
    );
  if (phase === 'asked')
    return (
      <View testID="rajaa-cash-asked" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
        <StatusPill tone="info" icon="clock" live label={t('rajaa.cash_waiting', { name })} />
      </View>
    );
  if (phase === 'declined' || phase === 'owed')
    return (
      <View testID={`rajaa-cash-${phase}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
        <Icon name={phase === 'owed' ? 'wallet' : 'cash'} size={16} color={phase === 'owed' ? 'warningText' : 'textMuted'} strokeWidth={2} style={{ marginTop: 2 }} />
        <Text variant="footnote" color={phase === 'owed' ? 'warningText' : 'textMuted'} style={{ flex: 1 }}>
          {phase === 'owed' ? t('rajaa.cash_owed', { amount: amountParam(owedIqd) }) : t('rajaa.cash_no', { name })}
        </Text>
      </View>
    );
  return (
    <View
      testID="rajaa-cash-accepted"
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1.5, borderColor: theme.colors.accent, backgroundColor: theme.colors.surface }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cash" size={18} color="accentText" strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
          <Text variant="label" weight={700}>
            {t('rajaa.cash_yes_title', { name })}
          </Text>
          <StatusPill size="sm" tone="success" icon="check" label={t('rajaa.cash_yes_none')} />
        </View>
      </View>
      <RuleList tone="text" items={[t('rajaa.cash_yes_rule_rider', { amount, name }), t('rajaa.cash_yes_rule_driver', { amount, name })]} />
      <Button testID="rajaa-cash-book" size="lg" fullWidth icon="cash" haptic="success" label={t('rajaa.cash_book', { amount: amountParam(priceIqd) })} loading={booking} onPress={onBook} />
    </View>
  );
}
