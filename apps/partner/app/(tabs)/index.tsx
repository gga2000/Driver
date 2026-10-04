import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { agoText, EmptyState, Icon, Skeleton, Text, useConnectionBanner, useTheme, usePulse, useToast, type IconName } from '@driver/ui';
import Animated from 'react-native-reanimated';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { BlockedSwitch, GateBanner } from '@/features/account/GateParts';
import { gateKind } from '@/features/account/logic';
import { FleetInviteBanner } from '@/features/fleet/InviteParts';
import { splitInvites } from '@/features/fleet/logic';
import { useFleetInvites } from '@/features/fleet/queries';
import { DriverMap } from '@/features/map/DriverMap';
import { ActiveJobBanner, CashBar, DemandRow, ModeCard, TodayPill, VehicleChip } from '@/features/work/HomeParts';
import { VEHICLE_ICON } from '@/features/work/logic';
import { OnlineSwitch } from '@/features/work/OnlineSwitch';
import { PrePromptGate } from '@/features/notify/Push';
import { useStatus } from '@/features/work/queries';
import { usePresence } from '@/features/work/usePresence';
import { useT } from '@/lib/i18n';
import { LIVE_PARTNER_KEY, useLiveMode } from '@/lib/live';

/**
 * الرئيسية — waiting for work. Map with his own puck, today's earnings pill, the vehicle he is on,
 * and a bottom panel: status, demand hint, mode cards (garage board / khat run), cash vs cap and
 * the big online switch. The offer card comes up over this by itself (root `<OfferWatcher>`).
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const status = useStatus();
  const s = status.data;
  const presence = usePresence(s);
  const [panelH, setPanelH] = useState(320);
  const online = s?.online ?? false;
  const vehicle = s?.vehicleClass ?? 'bike';
  const toast = useToast();
  // P-09: the server may say "online", but with no network no offer can reach him. Say that instead.
  const conn = useConnectionBanner({ live: useLiveMode(LIVE_PARTNER_KEY), updatedAt: status.dataUpdatedAt || null });
  const cut = !conn.net.online;
  const pulse = usePulse(online && !cut);
  // Online gate (scoring §2): no check-in today, locked out, or an expired document keeps him offline.
  const gate = online ? null : gateKind(s?.gate);
  // A fleet owner's invite waits for his yes (nothing reaches the owner before it).
  const invites = useFleetInvites(s?.canDrive ?? false);
  const invite = splitInvites(invites.data ?? []).pending[0] ?? null;

  return (
    <View testID="home" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <DriverMap self={s?.position ?? null} vehicleIcon={VEHICLE_ICON[vehicle]} online={online} topInset={110} bottomInset={panelH} soloZoom={14.4} />

      <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
        <View pointerEvents="box-none" style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[3], gap: theme.space[3] }}>
          {s ? <TodayPill earningsIqd={s.today.earningsIqd} jobs={s.today.jobs} /> : <Skeleton width={180} height={44} radius={22} style={{ alignSelf: 'center' }} />}
          {s?.canDrive ? (
            <View pointerEvents="box-none" style={{ flexDirection: 'row' }}>
              <VehicleChip vehicle={vehicle} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      <View
        onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          bottom: 0,
          start: 0,
          end: 0,
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -4 },
          elevation: 10,
        }}
      >
        <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: theme.space[5], paddingBottom: theme.space[4], gap: theme.space[4] }}>
          {/* A failed refresh while we still show the last status: offers can't reach him, say so. */}
          {s && !cut && conn.kind === 'stale' ? (
            <View testID="home-stale" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.warningTint }}>
              <Icon name="clock" size={18} color="warningText" />
              <Text variant="label" color="warningText" style={{ flex: 1 }}>
                {t('net.stale', { ago: agoText(conn.ageSeconds ?? 0, t) })}
              </Text>
            </View>
          ) : null}
          {s && !cut && status.isError ? (
            <View testID="home-connection-lost" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.warningTint }}>
              <Icon name="clock" size={18} color="warningText" />
              <Text variant="label" color="warningText" style={{ flex: 1 }}>
                {t('partner.connection_lost')}
              </Text>
            </View>
          ) : null}
          {!s && status.isError ? (
            <EmptyState
              icon="phone"
              title={t('partner.status_failed')}
              body={t('error.network')}
              action={{ label: t('action.retry'), onPress: () => void status.refetch() }}
              style={{ paddingVertical: theme.space[4] }}
            />
          ) : !s ? (
            <View style={{ gap: theme.space[3] }}>
              <Skeleton width="60%" height={24} />
              <Skeleton width="100%" height={72} radius={36} />
            </View>
          ) : (
            <>
              {s.canDrive ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
                    {online && !cut ? <Animated.View style={[{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.success }, pulse]} /> : null}
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cut ? theme.colors.danger : online ? theme.colors.success : theme.colors.borderStrong }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="title" testID="home-status" color={cut ? 'dangerText' : undefined}>
                      {cut ? t(conn.net.state === 'unreachable' ? 'partner.net_unreachable_title' : 'partner.net_offline_title') : online ? t('partner.online_title') : t('partner.offline_title')}
                    </Text>
                    <Text variant="footnote" color="textMuted">
                      {cut
                        ? t('partner.net_offline_body', { ago: agoText(conn.ageSeconds ?? 0, t) })
                        : online
                          ? t('partner.online_body')
                          : t('partner.offline_body')}
                    </Text>
                  </View>
                </View>
              ) : null}

              {s.activeTripId ? <ActiveJobBanner /> : null}
              {invite && !s.activeTripId ? <FleetInviteBanner invite={invite} /> : null}
              {online && !cut && s.demand ? <DemandRow demand={s.demand} /> : null}

              {s.modes.includes('intercity') ? (
                <ModeCard testID="mode-intercity" icon="garage" href="/intercity" title={t('partner.intercity_card_title')} body={t('partner.intercity_card_body')} cta={t('partner.intercity_card_cta')} />
              ) : null}
              {s.modes.includes('khat') ? (
                <ModeCard testID="mode-khat" icon="seat" href="/khat" title={t('partner.khat_card_title')} body={t('partner.khat_card_body')} cta={t('partner.khat_card_cta')} />
              ) : null}
              {!s.canDrive ? <NonDriverHub modes={s.modes} /> : null}

              {s.canDrive && gate ? <GateBanner kind={gate} /> : null}
              {s.canDrive ? <CashBar cash={s.cash} /> : null}
              {s.canDrive && gate ? <BlockedSwitch kind={gate} /> : null}
              {s.canDrive && !gate ? <OnlineSwitch
                  online={online}
                  busy={presence.busy}
                  onGoOnline={() => (cut ? toast.show({ message: t('partner.go_online_offline'), tone: 'warning', icon: 'wifi-off' }) : void presence.goOnline())}
                  onGoOffline={() => void presence.goOffline()}
                /> : null}
            </>
          )}
        </View>
      </View>
      {/* Offers ring with the app closed only with notifications on: ask here, before he goes online. */}
      <PrePromptGate active={Boolean(s?.canDrive)} />
    </View>
  );
}

/** Fleet owners and field ops: their work lives in wave-2 routes; home points there. */
function NonDriverHub({ modes }: { modes: readonly string[] }) {
  const theme = useTheme();
  const t = useT();
  const items: { icon: IconName; title: string; body: string; mode: string }[] = [
    { icon: 'car', title: t('partner.hub_fleet'), body: t('partner.hub_fleet_sub'), mode: 'fleet' },
    { icon: 'map-pin', title: t('partner.hub_ops'), body: t('partner.hub_ops_sub'), mode: 'ops' },
  ];
  return (
    <View style={{ gap: theme.space[2] }}>
      {items
        .filter((i) => modes.includes(i.mode))
        .map((i) => (
          <View key={i.mode} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name={i.icon} size={22} color="accentText" />
            <View style={{ flex: 1 }}>
              <Text variant="label" weight={600}>
                {i.title}
              </Text>
              <Text variant="caption" color="textMuted">
                {i.body}
              </Text>
            </View>
          </View>
        ))}
    </View>
  );
}
