import { View } from 'react-native';
import { Button, Card, Icon, Text, useTheme, type IconName } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { requireSignIn } from '@/lib/guest';
import { useT } from '@/lib/i18n';

const KINDS = {
  orders: { icon: 'receipt', nav: 'nav.orders', title: 'guest.orders_title', body: 'guest.orders_body', path: '/orders' },
  wallet: { icon: 'wallet', nav: 'nav.wallet_short', title: 'guest.wallet_title', body: 'guest.wallet_body', path: '/wallet' },
  account: { icon: 'user', nav: 'nav.account', title: 'guest.account_title', body: 'guest.account_body', path: '/account' },
} as const satisfies Record<string, { icon: IconName; nav: MessageKey; title: MessageKey; body: MessageKey; path: string }>;

/**
 * A tab a guest opened (طلباتي، المحفظة، حسابي): what lives there, and one button to add the phone
 * number, which brings them back to this tab after OTP (audit C-18).
 */
export function GuestGate({ kind }: { kind: keyof typeof KINDS }) {
  const theme = useTheme();
  const t = useT();
  const k = KINDS[kind];
  return (
    <Screen testID={`guest-${kind}`}>
      <Text variant="heading" accessibilityRole="header">
        {t(k.nav)}
      </Text>
      <Card padding={5} elevation={0} style={{ alignItems: 'center', gap: theme.space[4], marginTop: theme.space[4] }}>
        <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={k.icon} size={34} color="accentText" strokeWidth={1.7} />
        </View>
        <View style={{ gap: theme.space[2], alignItems: 'center' }}>
          <Text variant="title" align="center">
            {t(k.title)}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
            {t(k.body)}
          </Text>
        </View>
        <Button testID="guest-sign-in" icon="phone" size="lg" fullWidth label={t('guest.sign_in')} onPress={() => void requireSignIn(k.path)} />
      </Card>
    </Screen>
  );
}
