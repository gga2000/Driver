import { router } from 'expo-router';
import { View } from 'react-native';
import { OPEN_WALKUP_STATES } from '@driver/contracts';
import { Card, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { cartPalette } from './palette';
import { useMyWalkups } from './queries';

/**
 * The walk-over tickets still open, on top of «عربانات العزيزية»: the cart, the code to say and whether
 * it is ready. A tap opens the ticket. Nothing shows without one.
 */
export function TicketBanner() {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const mine = useMyWalkups();
  const open = (mine.data ?? []).filter((w) => OPEN_WALKUP_STATES.includes(w.state));
  if (open.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      {open.map((w) => (
        <Card key={w.id} testID={`carts-ticket-${w.id}`} padding={4} lift onPress={() => router.push({ pathname: '/food-carts/ticket/[id]', params: { id: w.id } })} accessibilityLabel={`${t('carts.ticket_at', { name: w.cartName })}، ${t('carts.ticket_code', { code: w.code })}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ minWidth: 64, height: 56, borderRadius: theme.radius.lg, backgroundColor: theme.colors.inverse, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[2] }}>
              <Text variant="heading" face="display" tabular color={theme.colors.onInverse} fixed>
                {w.code}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {t('carts.ticket_at', { name: w.cartName })}
              </Text>
              <Text variant="footnote" weight={600} color={w.state === 'ready' ? pal.text : 'textMuted'} numberOfLines={1}>
                {w.state === 'ready' ? t('carts.ticket_ready_short') : t('carts.ticket_cooking_short')}
              </Text>
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}
