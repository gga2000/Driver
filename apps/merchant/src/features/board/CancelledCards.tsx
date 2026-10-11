import { Pressable, View } from 'react-native';
import type { CancelledOrder } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useT } from '@/lib/i18n';

/**
 * «انلغى، لا تكمل»: an order the kitchen had accepted and that was then cancelled, as a red card above
 * the board until someone taps it (one tap = gone on this device). The server keeps it 15 minutes.
 */
export function CancelledCards({ cards, wide, onDismiss }: { cards: readonly CancelledOrder[]; wide: boolean; onDismiss: (orderId: string) => void }) {
  const theme = useTheme();
  const t = useT();
  if (cards.length === 0) return null;
  return (
    <View testID="cancelled-cards" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3], paddingHorizontal: wide ? theme.space[5] : theme.space[4], paddingTop: theme.space[3] }}>
      {cards.map((c) => {
        const title = t('merchant.cancelled.title', { number: c.number });
        const body = t(c.wasReady ? 'merchant.cancelled.body_ready' : 'merchant.cancelled.body_cooking');
        return (
          <Pressable
            key={c.orderId}
            testID={`cancelled-${c.orderId}`}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${body}`}
            accessibilityHint={t('merchant.cancelled.hint')}
            onPress={() => onDismiss(c.orderId)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: wide ? 360 : '100%',
              minHeight: 64,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              paddingHorizontal: theme.space[4],
              paddingVertical: theme.space[3],
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.danger,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <MIcon name="alert" size={24} color={theme.colors.onDanger} strokeWidth={2.2} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" weight={700} color="onDanger">
                {title}
              </Text>
              <Text variant="body" color="onDanger">
                {body}
              </Text>
            </View>
            <View style={{ minHeight: 44, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, justifyContent: 'center' }}>
              <Text variant="label" weight={700} color="dangerText" compact>
                {t('merchant.cancelled.dismiss')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
