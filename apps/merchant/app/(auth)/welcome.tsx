import { router } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, useTheme } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Wordmark } from '@/components/Wordmark';
import { TicketArt } from '@/features/auth/TicketArt';
import { SUPPORT_PHONE } from '@/lib/env';
import { useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

const POINTS: readonly { icon: MIconName; key: TKey }[] = [
  { icon: 'bell', key: 'merchant.welcome.point_orders' },
  { icon: 'bike', key: 'merchant.welcome.point_courier' },
  { icon: 'cash', key: 'merchant.welcome.point_money' },
];

/** Merchant welcome: what the app does for a kitchen, in three lines, and one way in. */
export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();

  const copy = (
    <View style={{ gap: theme.space[6], maxWidth: 480 }}>
      <Wordmark />
      <View style={{ gap: theme.space[3] }}>
        <Text weight={700} style={{ fontSize: wide ? 38 : 30, lineHeight: wide ? 56 : 46 }}>
          {t('merchant.welcome.title')}
        </Text>
      </View>
      <View style={{ gap: theme.space[4] }}>
        {POINTS.map((p) => (
          <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
              <MIcon name={p.icon} size={22} color="accentText" />
            </View>
            <Text variant="body" style={{ flex: 1, fontSize: 17, lineHeight: 28 }}>
              {t(p.key)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
  const actions = (
    <View style={{ gap: theme.space[3], width: '100%', maxWidth: 480 }}>
      <Button testID="welcome-start" label={t('merchant.welcome.start')} icon="phone" size="lg" fullWidth haptic="medium" onPress={() => router.push('/phone')} />
      <Button label={t('merchant.welcome.partner_hint')} variant="ghost" size="sm" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
    </View>
  );

  if (wide) {
    return (
      <SafeAreaView testID="welcome" style={{ flex: 1, backgroundColor: theme.colors.bg, flexDirection: 'row' }}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: theme.space[12], gap: theme.space[8] }}>
          {copy}
          {actions}
        </View>
        <View style={{ flex: 1, margin: theme.space[5], borderRadius: 36, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', width: 520, height: 520, borderRadius: 260, backgroundColor: theme.colors.bg, opacity: 0.55, top: -140, end: -160 }} />
          <TicketArt scale={1.25} />
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView testID="welcome" edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: theme.space[5], paddingTop: theme.space[4], gap: theme.space[6] }}>
        <View style={{ height: 290, borderRadius: 28, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <TicketArt scale={0.7} />
        </View>
        {copy}
      </ScrollView>
      <View style={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[3] }}>{actions}</View>
    </SafeAreaView>
  );
}
