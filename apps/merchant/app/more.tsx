import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { Page } from '@/components/Page';
import { unregisterPush } from '@/features/notify/Push';
import { useCurrentStore } from '@/features/store/queries';
import { useApiClient } from '@/lib/api';
import { SUPPORT_PHONE } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { session } from '@/lib/session';

/** المزيد — staff, deals, printer, store hours, settings; switch store, call Driver, sign out. */
export default function More() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const { store, stores, canSeeMoney } = useCurrentStore();
  const grid = { flexDirection: wide ? ('row' as const) : ('column' as const), flexWrap: 'wrap' as const, gap: theme.space[3] };
  const cell = wide ? { flexBasis: '48%' as const, flexGrow: 1 } : undefined;
  const client = useApiClient();
  // Best effort: drop this device's push token and end the session server-side (which also drops
  // the session's tokens), then forget the session here regardless.
  const signOut = async () => {
    const refreshToken = session.getSnapshot().session?.refreshToken;
    await unregisterPush(client);
    await client.identity.logout.mutate(refreshToken ? { refreshToken } : {}).catch(() => undefined);
    await session.signOut();
  };
  return (
    <Page title={t('merchant.more.title')} subtitle={store?.name} testID="more" maxWidth={960}>
      <View style={grid}>
        {canSeeMoney ? (
          <View style={cell}>
            <EntryTile testID="more-staff" icon="people" title={t('merchant.more.staff')} hint={t('merchant.more.staff_hint')} onPress={() => router.push('/staff')} />
          </View>
        ) : null}
        <View style={cell}>
          <EntryTile testID="more-deals" icon="tag" title={t('merchant.more.deals')} hint={t('merchant.more.deals_hint')} onPress={() => router.push('/deals')} />
        </View>
        <View style={cell}>
          <EntryTile testID="more-printer" icon="printer" title={t('merchant.printer.title')} hint={t('merchant.more.printer_hint')} onPress={() => router.push('/printer')} />
        </View>
        <View style={cell}>
          <EntryTile testID="more-hours" icon="clock" title={t('merchant.more.hours')} hint={t('merchant.more.hours_hint')} onPress={() => router.push('/hours')} />
        </View>
        <View style={cell}>
          <EntryTile testID="more-pickup-spot" icon="map-pin" title={t('merchant.more.pickup_spot')} hint={t('merchant.more.pickup_spot_hint')} onPress={() => router.push('/pickup-spot')} />
        </View>
        <View style={cell}>
          <EntryTile testID="more-delivery-area" icon="grid" title={t('merchant.more.delivery_area')} hint={t('merchant.more.delivery_area_hint')} onPress={() => router.push('/delivery-area')} />
        </View>
        <View style={cell}>
          <EntryTile testID="more-settings" icon="sliders" title={t('merchant.more.settings')} hint={t('merchant.more.settings_hint')} onPress={() => router.push('/settings')} />
        </View>
      </View>
      <View style={{ gap: theme.space[3] }}>
        {stores.length > 1 ? <EntryTile icon="swap" title={t('merchant.more.switch_store')} hint={store?.name} onPress={() => router.push('/stores')} /> : null}
        <EntryTile icon="phone" title={t('merchant.more.support')} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <EntryTile testID="sign-out" icon="sign-out" title={t('merchant.more.sign_out')} tone="danger" onPress={() => void signOut()} trailing={<View />} />
      </View>
      <Text variant="caption" color="textMuted" align="center">
        {t('merchant.settings.version', { version: '0.1.0' })}
      </Text>
    </Page>
  );
}
