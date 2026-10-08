import { Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Button, Text, useTheme } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { STORE_URL, STORE_WEB_URL } from '@/lib/app-version';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';

/** Play app first; the web listing when the market scheme can't open (no Play, Android 11 queries). */
async function openStore(): Promise<void> {
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(STORE_URL))) {
      await Linking.openURL(STORE_URL);
      return;
    }
  } catch {
    // fall through to the web listing
  }
  await Linking.openURL(STORE_WEB_URL).catch(() => undefined);
}

/**
 * CORE-05: the server no longer serves this build («حدّث التطبيق»). One calm full-screen page in place
 * of the whole app: it needs no network, never retries, and stays until the app restarts on the new
 * build from the store (src/lib/app-version.ts switches to it).
 */
export function UpdateRequired() {
  const theme = useTheme();
  const t = useT();
  return (
    <SafeAreaView testID="update-required" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[6], gap: theme.space[6] }}>
        <Wordmark size="md" />
        <UpdateArt />
        <View style={{ gap: theme.space[2], maxWidth: 460 }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('merchant.update.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ fontSize: 16, lineHeight: 28 }}>
            {t('merchant.update.body')}
          </Text>
        </View>
        <View style={{ width: '100%', maxWidth: 400 }}>
          <Button testID="update-open-store" label={t('merchant.update.open_store')} size="lg" fullWidth onPress={() => void openStore()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

/** A phone with the new version coming down into it, on the counter's saffron tile. */
function UpdateArt() {
  return (
    <View style={{ width: 120, height: 120, borderRadius: 40, backgroundColor: COUNTER.laneNew, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}>
      <View style={{ transform: [{ rotate: '6deg' }] }}>
        <Svg width={64} height={64} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Rect x={16} y={6} width={32} height={52} rx={7} fill={COUNTER.paper} stroke={COUNTER.date} strokeWidth={3} />
          <Path d="M27 12h10" stroke={COUNTER.date} strokeWidth={3} strokeLinecap="round" />
          <Path d="M32 22v16M25 32l7 7 7-7" fill="none" stroke={COUNTER.newBadge} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M25 45h14" stroke={COUNTER.newBadge} strokeWidth={3.5} strokeLinecap="round" />
          <Circle cx={32} cy={52} r={2} fill={COUNTER.date} />
        </Svg>
      </View>
    </View>
  );
}
