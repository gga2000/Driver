import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GuardianRunView } from '@driver/contracts';
import { EmptyState, Icon, IconButton, Skeleton, Text, useLiteMode, useNetwork, useTheme } from '@driver/ui';
import { useGuardianChildren } from '@/features/account/queries';
import { busHeadline, staleMinutes } from '@/features/khat/bus';
import { KHAT_MAP, KhatMap } from '@/features/khat/KhatMap';
import { useGuardianRun } from '@/features/khat/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const TOP_BAR = 56;
const SHADOW = '0 2px 8px rgba(40,24,8,0.18)';

/**
 * «وين الباص» (map idea N14, «بس بيتك والباص»): today's school run of one of the guardian's own
 * children on the Golden hour map: his home, the school and the bus (only while it heads to one of
 * them). Other children's stops are blank dots with no place. The sheet says where things stand in
 * words, so a phone without the map, or a map that fails, still gets the whole answer.
 */
export default function BusScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const lite = useLiteMode();
  const net = useNetwork();
  const { childRef } = useLocalSearchParams<{ childRef: string }>();
  const q = useGuardianRun(childRef);
  const children = useGuardianChildren();
  // The name only titles the screen: without it (still loading, or the list failed) the title is «وين الباص».
  const name = children.isError ? undefined : children.data?.find((c) => c.childRef === childRef)?.name;
  const [failed, setFailed] = useState(false);
  const [sheetH, setSheetH] = useState(220);
  const view = q.data ?? null;
  const withMap = KHAT_MAP && !failed && view !== null;

  const centred = (node: React.ReactNode) => <View style={{ flex: 1, justifyContent: 'center', paddingTop: insets.top + TOP_BAR }}>{node}</View>;

  let body: React.ReactNode;
  if (q.isPending) {
    body = centred(
      <View style={{ paddingHorizontal: theme.space[4] }} testID="khat-bus-loading">
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space[4] }]}>
          <Skeleton lines={3} />
        </View>
      </View>,
    );
  } else if (q.error && !q.data) {
    body = centred(
      <EmptyState icon={net.online ? 'refresh' : 'wifi-off'} title={net.online ? apiErrorMessage(q.error, t('khat_bus.error'), locale) : t('net.offline_title')} action={{ label: t('action.retry'), onPress: () => void q.refetch() }} />,
    );
  } else if (!view) {
    body = centred(<EmptyState icon="rajaa" title={t('khat_bus.no_run')} body={t('khat_bus.no_run_body')} />);
  } else {
    const sheet = <BusSheet view={view} offline={!net.online} onLayout={(h) => setSheetH(h)} />;
    body = withMap ? (
      <>
        <KhatMap view={view} topInset={insets.top + TOP_BAR} bottomInset={sheetH} lite={lite} onFail={() => setFailed(true)} />
        <View pointerEvents="box-none" style={styles.bottom}>
          {sheet}
        </View>
      </>
    ) : (
      // No map on this build, or it failed: the sheet alone says it all.
      <View style={{ flex: 1, paddingTop: insets.top + TOP_BAR + theme.space[2] }}>{sheet}</View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="khat-bus">
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + theme.space[2], paddingHorizontal: theme.space[3], gap: theme.space[2] }]}>
        <View style={{ borderRadius: 22, backgroundColor: theme.colors.surface, boxShadow: SHADOW }}>
          <IconButton icon="arrow-back" variant="plain" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/household/children'))} testID="header-back" />
        </View>
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: SHADOW }}>
          <Icon name="family" size={18} color="accentText" strokeWidth={2} />
          <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }} testID="khat-bus-title">
            {name ? t('khat_bus.title', { name }) : t('khat_bus.title_plain')}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The card at the bottom: the leg, the headline, how old the bus's place is, and the privacy line. */
function BusSheet({ view, offline, onLayout }: { view: GuardianRunView; offline: boolean; onLayout: (h: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const head = busHeadline(view);
  const stale = staleMinutes(view, Date.now());
  return (
    <View
      testID="khat-bus-sheet"
      onLayout={(e) => onLayout(Math.round(e.nativeEvent.layout.height))}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          paddingTop: theme.space[4],
          paddingHorizontal: theme.space[5],
          paddingBottom: insets.bottom + theme.space[4],
          gap: theme.space[2],
        },
      ]}
    >
      <Text variant="footnote" color="textMuted" weight={600} testID="khat-bus-leg">
        {t(view.leg === 'to_school' ? 'khat_bus.leg_to_school' : 'khat_bus.leg_to_home')}
      </Text>
      <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite" testID="khat-bus-headline">
        {t(head.key as never, head.params)}
      </Text>
      {stale !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="khat-bus-stale">
          <Icon name="clock" size={16} color="warningText" />
          <Text variant="footnote" color="warningText">
            {t('khat_bus.stale', { n: stale })}
          </Text>
        </View>
      ) : null}
      {offline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="khat-bus-offline">
          <Icon name="wifi-off" size={16} color="warningText" />
          <Text variant="footnote" color="warningText">
            {t('khat_bus.offline')}
          </Text>
        </View>
      ) : null}
      <View testID="khat-bus-privacy" style={{ marginTop: theme.space[2], flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <Icon name="shield" size={22} color="text" strokeWidth={1.9} />
        <Text variant="footnote" style={{ flex: 1 }}>
          {t('khat_bus.privacy')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: { boxShadow: '0 -2px 16px rgba(40,24,8,0.12)' },
});
