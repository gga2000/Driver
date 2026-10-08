import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { agoText, EmptyState, Icon, Skeleton, SlideToConfirm, Text, useConnectionBanner, useTheme, useToast, type IconName } from '@driver/ui';
import { BlockedSwitch, GateBanner, PapersBanner } from '@/features/account/GateParts';
import { gateKind, papersReminder } from '@/features/account/logic';
import { useDocuments } from '@/features/account/queries';
import { LostItemStrips } from '@/features/chat/LostItems';
import { FleetInviteBanner } from '@/features/fleet/InviteParts';
import { splitInvites } from '@/features/fleet/logic';
import { useFleetInvites } from '@/features/fleet/queries';
import { AttentionStack, CashLine, DASH_MAX_WIDTH, DashTop, ModeTile, WorkHintCard } from '@/features/home/DashParts';
import { attentionOrder, cashLoudness, dashState, firstName, workHint, type AttentionKind } from '@/features/home/logic';
import { MapPeek } from '@/features/home/MapPeek';
import { ShiftCheckSheet, useShiftCheckDue } from '@/features/home/ShiftCheck';
import { ActiveJobBanner } from '@/features/work/HomeParts';
import { ClimateCheckCard } from '@/features/work/ClimateCheck';
import { mapsUrl } from '@/features/work/logic';
import { openNav, useNavApp } from '@/features/work/nav';
import { ReadinessRow } from '@/features/work/ReadinessRow';
import { PrePromptGate } from '@/features/notify/Push';
import { useBookedJobs, useDemandMap, useMe, useStatus } from '@/features/work/queries';
import { bookedHome } from '@/features/work/booked-logic';
import { usePresence } from '@/features/work/usePresence';
import { useLocale, useT } from '@/lib/i18n';
import { formatWhen } from '@driver/i18n';
import { LIVE_PARTNER_KEY, useLiveMode } from '@/lib/live';

/** «7:42» in Baghdad time, Western digits. */
function clockOf(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Baghdad' }).format(d);
}

/**
 * الرئيسية — «الدشبول» (partner redesign h1–h11). No map while he waits: the state top (cream /
 * saffron working / ink no internet), today's money huge, the one thing that needs him (and «+2
 * بعد»), where the work is with «روح هناك» and «وريني الخريطة», the readiness line, a quiet cash
 * line, and the 72 px slide at the bottom: slide to start, slide to stop. The offer comes up over
 * this by itself (root `<OfferWatcher>`).
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const status = useStatus();
  const me = useMe();
  const s = status.data;
  const presence = usePresence(s);
  const online = s?.online ?? false;
  const vehicle = s?.vehicleClass ?? 'bike';
  const toast = useToast();
  const nav = useNavApp();
  // P-09: the server may say "online", but with no network no offer can reach him. Say that instead.
  const conn = useConnectionBanner({ live: useLiveMode(LIVE_PARTNER_KEY), updatedAt: status.dataUpdatedAt || null });
  const cut = !conn.net.online;
  const demandMap = useDemandMap(online && (s?.canDrive ?? false));
  // Online gate (scoring §2): no check-in today, locked out, or an expired document keeps him offline.
  const gate = online ? null : gateKind(s?.gate);
  // a3: a paper reaches home only in its last 14 days.
  const papers = papersReminder(useDocuments().data);
  // A fleet owner's invite waits for his yes (nothing reaches the owner before it).
  const invites = useFleetInvites(s?.canDrive ?? false);
  const invite = splitInvites(invites.data ?? []).pending[0] ?? null;
  const [peek, setPeek] = useState(false);
  const closePeek = useCallback(() => setPeek(false), []);
  const check = useShiftCheckDue();
  const [checking, setChecking] = useState(false);
  // Review #28: «مشاوير باچر» for taxi and tuktuk drivers.
  const bookedJobs = useBookedJobs(s?.modes.includes('city') ?? false);
  const booked = bookedHome(bookedJobs.data, new Date());

  const state = dashState(online, !cut);
  const hint = s?.canDrive ? workHint(s.demand, s.position) : null;
  const goOnline = () => {
    if (cut) {
      toast.show({ message: t('partner.go_online_offline'), tone: 'warning', icon: 'wifi-off' });
      return;
    }
    // h8: once a day, the start-of-shift check comes first.
    if (check.due) setChecking(true);
    else void presence.goOnline();
  };
  const goThere = () => {
    if (!hint) return;
    const app = nav.app ?? 'google';
    void openNav(app, hint.at).catch(() => void Linking.openURL(mapsUrl(hint.at)).catch(() => undefined));
  };

  // h9: what needs him, most urgent first; the first shows, the rest fold away.
  const attention: { key: AttentionKind; node: React.ReactNode }[] = [];
  if (s) {
    const present: AttentionKind[] = [];
    if (s.activeTripId) present.push('job');
    if (s.canDrive && gate) present.push('gate');
    if (s.canDrive && (cashLoudness(s.cash) === 'near' || cashLoudness(s.cash) === 'blocked')) present.push('cash');
    if (s.canDrive && papers && gate !== 'document') present.push('papers');
    if (invite && !s.activeTripId) present.push('invite');
    if (online && s.climateCheck) present.push('climate');
    for (const k of attentionOrder(present)) {
      if (k === 'job') attention.push({ key: k, node: <ActiveJobBanner /> });
      if (k === 'gate' && gate) attention.push({ key: k, node: <GateBanner kind={gate} /> });
      if (k === 'cash') attention.push({ key: k, node: <CashLine cash={s.cash} /> });
      if (k === 'papers' && papers) attention.push({ key: k, node: <PapersBanner kind={papers.kind} days={papers.days} /> });
      if (k === 'invite' && invite) attention.push({ key: k, node: <FleetInviteBanner invite={invite} /> });
      if (k === 'climate' && s.climateCheck) attention.push({ key: k, node: <ClimateCheckCard check={s.climateCheck} /> });
    }
  }

  const column = { width: '100%' as const, maxWidth: DASH_MAX_WIDTH, alignSelf: 'center' as const };
  return (
    <View testID="home" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <DashTop
        state={s?.canDrive ? state : 'waiting'}
        name={firstName(me.data?.name)}
        vehicle={vehicle}
        earningsIqd={s ? s.today.earningsIqd : null}
        jobs={s?.today.jobs ?? 0}
        sinceClock={online && s?.onlineSince ? clockOf(s.onlineSince, locale) : null}
        cutTitle={t(conn.net.state === 'unreachable' ? 'partner.net_unreachable_title' : 'partner.net_offline_title')}
        cutBody={t('partner.net_offline_body', { ago: agoText(conn.ageSeconds ?? 0, t) })}
        canDrive={s?.canDrive ?? true}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4], paddingBottom: theme.space[4], gap: theme.space[3] }}>
        <View style={[column, { gap: theme.space[3] }]}>
          {!s && status.isError ? (
            <EmptyState icon="phone" title={t('partner.status_failed')} body={t('error.network')} action={{ label: t('action.retry'), onPress: () => void status.refetch() }} style={{ paddingVertical: theme.space[4] }} />
          ) : !s ? (
            <View style={{ gap: theme.space[3] }}>
              <Skeleton width="100%" height={120} radius={20} />
              <Skeleton width="70%" height={20} />
            </View>
          ) : (
            <>
              {/* A failed refresh while we still show the last status: offers can't reach him, say so. */}
              {!cut && (conn.kind === 'stale' || status.isError) ? (
                <View testID={status.isError ? 'home-connection-lost' : 'home-stale'} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: 16, backgroundColor: theme.colors.warningTint }}>
                  <Icon name="clock" size={18} color="warningText" />
                  <Text variant="label" color="warningText" style={{ flex: 1 }}>
                    {status.isError ? t('partner.connection_lost') : t('net.stale', { ago: agoText(conn.ageSeconds ?? 0, t) })}
                  </Text>
                </View>
              ) : null}
              <AttentionStack items={attention} />
              {/* s7: a rider looking for something left in the car (the chat is open again for 24 h). */}
              {s.canDrive ? <LostItemStrips /> : null}
              {hint ? <WorkHintCard hint={hint} onGo={goThere} onMap={() => setPeek(true)} /> : null}

              {s.modes.includes('intercity') ? (
                <ModeTile testID="mode-intercity" icon="garage" title={t('partner.intercity_card_title')} body={t('partner.intercity_card_body')} cta={t('partner.intercity_card_cta')} onPress={() => router.push('/intercity')} />
              ) : null}
              {s.modes.includes('khat') ? (
                <ModeTile testID="mode-khat" icon="seat" title={t('partner.khat_card_title')} body={t('partner.khat_card_body')} cta={t('partner.khat_card_cta')} onPress={() => router.push('/khat')} />
              ) : null}
              {/* Review #28: rides booked for later — his next one, or how many wait for a driver. */}
              {booked ? (
                <ModeTile
                  testID="mode-booked"
                  icon="taxi"
                  title={t('partner.booked_title')}
                  body={booked.kind === 'mine' ? t('partner.booked_home_mine', { when: formatWhen(booked.at, new Date(), { locale }) }) : t('partner.booked_home_open', { n: booked.n })}
                  cta={t('partner.booked_home_cta')}
                  onPress={() => router.push('/booked')}
                />
              ) : null}
              {!s.canDrive ? <NonDriverHub modes={s.modes} /> : null}

              {/* S-8 / h6: GPS · النت · الصوت · البطارية, every shift, a quiet line when all is well. */}
              {s.canDrive && !gate ? <ReadinessRow /> : null}
              {s.canDrive && cashLoudness(s.cash) === 'quiet' ? <CashLine cash={s.cash} /> : null}
            </>
          )}
        </View>
      </ScrollView>

      {s?.canDrive ? (
        <SafeAreaView edges={[]} style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3], paddingTop: theme.space[2], backgroundColor: theme.colors.bg }}>
          <View style={column}>
            {gate ? (
              <BlockedSwitch kind={gate} />
            ) : online ? (
              <SlideToConfirm
                key="stop"
                testID="online-switch"
                tone="quiet"
                icon="pause"
                label={presence.busy ? t('partner.dash_slide_stopping') : t('partner.dash_slide_stop')}
                loading={presence.busy}
                confirmHaptic="warning"
                onConfirm={() => void presence.goOffline()}
              />
            ) : (
              <SlideToConfirm
                key="start"
                testID="online-switch"
                label={presence.busy ? t('partner.dash_slide_starting') : t('partner.dash_slide_start')}
                loading={presence.busy}
                // Starting is low-risk, so a tap starts too (P-40); stopping is a slide only.
                tapToConfirm
                confirmHaptic="medium"
                onConfirm={goOnline}
                style={{ borderRadius: 999, shadowColor: theme.colors.accent, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}
              />
            )}
          </View>
        </SafeAreaView>
      ) : null}

      <MapPeek visible={peek} onClose={closePeek} self={s?.position ?? null} vehicle={vehicle} online={online} zones={demandMap.data?.zones ?? []} />
      <ShiftCheckSheet
        visible={checking}
        checkedIn={!gate}
        onGo={() => {
          setChecking(false);
          check.markDone();
          void presence.goOnline();
        }}
        onLater={() => setChecking(false)}
      />
      {/* Offers ring with the app closed only with notifications on: ask here, before he goes online. */}
      {/* f4: asked when it is needed — once he is working, so no offer is missed — not on first sight. */}
      <PrePromptGate active={Boolean(s?.canDrive) && online} />
    </View>
  );
}

/** Fleet owners and field ops: their work lives in their own routes; home points there. */
function NonDriverHub({ modes }: { modes: readonly string[] }) {
  const t = useT();
  const items: { icon: IconName; title: string; body: string; mode: string; href: '/fleet' | '/ops' }[] = [
    { icon: 'car', title: t('partner.hub_fleet'), body: t('partner.hub_fleet_sub'), mode: 'fleet', href: '/fleet' },
    { icon: 'map-pin', title: t('partner.hub_ops'), body: t('partner.hub_ops_sub'), mode: 'ops', href: '/ops' },
  ];
  return (
    <>
      {items
        .filter((i) => modes.includes(i.mode))
        .map((i) => (
          <ModeTile key={i.mode} testID={`hub-${i.mode}`} icon={i.icon} title={i.title} body={i.body} cta="" onPress={() => router.push(i.href)} />
        ))}
    </>
  );
}
