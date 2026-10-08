import { View } from 'react-native';
import { Button, Card, Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { missingWords, secondsKey, secondsLeft, type PartialAsk } from './partial';

/**
 * BENCH-03: «بيبسي خلص بمطعم خالد» — what ran out, the new total against the old, and the two answers.
 * It takes the place of the waiting copy; the kitchen ring above counts the same minute.
 */
export function PartialAskCard({ ask, shop, now }: { ask: PartialAsk; shop: string; now: number }) {
  const theme = useTheme();
  const t = useT();
  const words = missingWords(ask);
  const left = secondsLeft(ask.deadline, now);
  return (
    <View style={{ alignSelf: 'stretch', gap: theme.space[3] }} testID="kitchen-partial">
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="heading" align="center" testID="kitchen-partial-title" accessibilityRole="header">
          {shop ? (words ? t('kitchen.partial_title', { items: words, name: shop }) : t('kitchen.partial_title_plain', { name: shop })) : t('kitchen.partial_title_bare')}
        </Text>
        <Text variant="body" color={left > 0 && left <= 15 ? 'warningText' : 'textMuted'} align="center" tabular accessibilityLiveRegion="polite" testID="kitchen-partial-left">
          {left > 0 ? `${t('kitchen.partial_body')} · ${t(secondsKey(left), { n: left })}` : t('kitchen.partial_ended')}
        </Text>
      </View>
      <Card elevation={0} padding={3}>
        <View style={{ gap: theme.space[2] }}>
          {ask.missing.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID={`kitchen-partial-line-${m.id}`}>
              <Icon name="x" size={16} color="dangerText" />
              <Text variant="body" style={{ flex: 1, textDecorationLine: 'line-through' }} color="textMuted">
                {m.qty > 1 ? `${m.qty}× ${m.name ?? t('kitchen.partial_item')}` : (m.name ?? t('kitchen.partial_item'))}
              </Text>
              <Text variant="caption" weight={600} color="dangerText">
                {t('kitchen.partial_missing')}
              </Text>
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.space[1] }} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="label" weight={600} style={{ flex: 1 }}>
              {t('kitchen.partial_new_total')}
            </Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="bodyStrong" tabular testID="kitchen-partial-total">
                {t('unit.iqd', { amount: amountParam(ask.reducedTotalIqd) })}
              </Text>
              <Text variant="caption" color="textMuted" tabular>
                {t('kitchen.partial_was', { amount: amountParam(ask.totalIqd) })}
              </Text>
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
}

/** The footer: «أرسل الباقي» first (what most people want), «ألغِ الطلب ببلاش» under it. */
export function PartialAskActions({ busy, onSend, onCancel, disabled }: { busy: 'send' | 'cancel' | null; onSend: () => void; onCancel: () => void; disabled: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Button testID="kitchen-partial-send" size="lg" fullWidth label={t('kitchen.partial_send')} loading={busy === 'send'} disabled={disabled || busy !== null} onPress={onSend} />
      <Button testID="kitchen-partial-cancel" variant="ghost" fullWidth label={t('kitchen.partial_cancel')} loading={busy === 'cancel'} disabled={disabled || busy !== null} onPress={onCancel} />
    </View>
  );
}
