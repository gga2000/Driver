import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
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
          <EntryTile testID="more-settings" icon="sliders" title={t('merchant.more.settings')} hint={t('merchant.more.settings_hint')} onPress={() => router.push('/settings')} />
        </View>
      </View>
      <View style={{ gap: theme.space[3] }}>
        {stores.length > 1 ? <EntryTile icon="swap" title={t('merchant.more.switch_store')} hint={store?.name} onPress={() => router.push('/stores')} /> : null}
        <EntryTile icon="phone" title={t('merchant.more.support')} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <EntryTile testID="sign-out" icon="sign-out" title={t('merchant.more.sign_out')} tone="danger" onPress={() => void session.signOut()} trailing={<View />} />
      </View>
      <Text variant="caption" color="textMuted" align="center">
        {t('merchant.settings.version', { version: '0.1.0' })}
      </Text>
    </Page>
  );
}
