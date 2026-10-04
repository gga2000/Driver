import { View } from 'react-native';
import { Button, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { Glyph } from './Glyph';
import { ModalSheet } from './ModalSheet';
import { useHandoverCode } from './queries';

/**
 * "سلّم الفلوس": how much to hand over first (P-05: the same "لازم تسلّم" number as home and earnings —
 * what he owes the company; his own pay stays with him), then the daily 4-digit code he reads to field
 * ops (`driverAccount.handoverCode`; ops type it into `ops.recordCashReceipt`), big enough to read
 * across a counter, and what he holds in hand.
 */
export function HandoverSheet({ visible, onClose, heldIqd, owedIqd }: { visible: boolean; onClose: () => void; heldIqd: number; owedIqd: number }) {
  const theme = useTheme();
  const t = useT();
  const code = useHandoverCode(visible);
  const digits = code.data?.code.split('') ?? [];
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('partner.handover_title')} testID="handover-sheet">
      <View testID="handover-amount" style={{ gap: 2 }}>
        <Text variant="heading" weight={700} tabular>
          {owedIqd > 0 ? t('partner.handover_give', { amount: amountParam(owedIqd) }) : t('partner.handover_nothing')}
        </Text>
        {owedIqd > 0 ? (
          <Text variant="footnote" color="textMuted">
            {t('partner.handover_give_hint')}
          </Text>
        ) : null}
      </View>
      <Text variant="body" color="textMuted">
        {t('partner.handover_body')}
      </Text>
      <View style={{ backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.xl, paddingVertical: theme.space[5], alignItems: 'center', gap: theme.space[3] }}>
        {code.data ? (
          <View testID="handover-code" accessibilityLabel={code.data.code} style={{ flexDirection: 'row', direction: 'ltr', gap: theme.space[3] }}>
            {digits.map((d, i) => (
              <View
                key={i}
                style={{
                  width: 60,
                  height: 76,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: theme.colors.shadow,
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                }}
              >
                <Text tabular weight={700} style={{ fontSize: 40, lineHeight: 52 }}>
                  {d}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width={60} height={76} radius={theme.radius.lg} />
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={14} color="accentText" strokeWidth={2.2} />
          <Text variant="caption" weight={600} color="accentText">
            {code.data ? t('partner.handover_valid') : t('partner.handover_loading')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[1] }}>
        <Text variant="label" color="textMuted">
          {t('partner.cash_held_now')}
        </Text>
        <Text variant="label" weight={600} color="textMuted" tabular>{`${amountParam(heldIqd)} ${t('quote.currency')}`}</Text>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Hint glyph="lock" text={t('partner.handover_private')} />
        <Hint icon text={t('partner.handover_other')} />
      </View>
      <Button testID="handover-close" label={t('partner.handover_done')} variant="secondary" fullWidth onPress={onClose} />
    </ModalSheet>
  );
}

function Hint({ glyph, icon, text }: { glyph?: 'lock'; icon?: boolean; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
      <View style={{ marginTop: 3 }}>{glyph ? <Glyph name={glyph} size={15} color="textMuted" /> : icon ? <Icon name="wallet" size={15} color="textMuted" strokeWidth={2} /> : null}</View>
      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
