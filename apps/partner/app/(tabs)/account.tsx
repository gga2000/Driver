import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import type { PartnerMode } from '@driver/contracts';
import { Avatar, Button, Card, DataSaverCard, ListRow, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { FleetInviteCard, FleetMemberCard } from '@/features/fleet/InviteParts';
import { splitInvites } from '@/features/fleet/logic';
import { useFleetInvites } from '@/features/fleet/queries';
import { unregisterPush } from '@/features/notify/Push';
import { navAppName, NavChooser } from '@/features/work/JobSheets';
import { setSpeakOffers, useSpeakOffers } from '@/features/offer/speak';
import { setNavApp, useNavApp } from '@/features/work/nav';
import { useMe, useStatus } from '@/features/work/queries';
import { checkInPill, mainPhotoStatus, METRIC_NAME, papersPill, scoreParts, weakestPart, type HubTone } from '@/features/account/logic';
import { absoluteUrl } from '@/features/account/photo';
import { useCheckInStatus, useDocuments, useMainPhoto, useScorecard } from '@/features/account/queries';
import { featureKey, featuresSummary, hasFeatures } from '@/features/vehicle/logic';
import { useMyVehicle } from '@/features/vehicle/queries';
import { saveDataSaverPref } from '@/lib/data-saver-pref';
import { playTestSound } from '@/lib/alert';
import { useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { session } from '@/lib/session';

interface HubRow {
  key: string;
  icon: IconName;
  title: string;
  subtitle: string;
  href: Href;
  /** Shown only to people with this mode; always shown when absent. */
  mode?: PartnerMode;
  pill?: { label: string; tone: HubTone } | null;
}

/**
 * الحساب (partner redesign a1): his approved photo and name on top (a2), then three groups — today
 * (the daily check-in and his papers, each with where it stands), you (how customers see you, photo,
 * car, score, kind words) and help and settings — with the other work he holds (garage board, خطوط,
 * fleet, ops) between them. Rows for modes he doesn't hold are hidden.
 */
export default function Account() {
  const theme = useTheme();
  const nav = useNavApp();
  const speak = useSpeakOffers();
  const [choosingNav, setChoosingNav] = useState(false);
  const t = useT();
  const me = useMe().data;
  const s = useStatus().data;
  const client = useApiClient();
  const toast = useToast();
  const modes = s?.modes ?? [];
  const tier = s?.tier ?? 'bronze';
  const canDrive = s?.canDrive ?? false;
  const invites = splitInvites(useFleetInvites(canDrive).data ?? []);
  const contact = me?.emergencyContact ?? null;
  // His main photo (Ali, 2026-10-06): the approved one is what customers see; the row says where the latest stands.
  const photo = useMainPhoto().data;
  const photoState = mainPhotoStatus(photo, t, { short: true });
  const photoUri = photo?.approved ? absoluteUrl(photo.approved.url) : undefined;
  // «مميزات سيارتك» (ride step 3): for the car or tuktuk he drives; a bike has none.
  const vehicle = useMyVehicle(canDrive).data;
  const features = vehicle && hasFeatures(vehicle.vehicleClass) ? featuresSummary(vehicle) : null;
  const docs = useDocuments().data;
  const checkIn = useCheckInStatus().data;
  const card = useScorecard().data;
  const weak = card?.visible && card.index !== null ? weakestPart(scoreParts(card.metrics, card.index)) : null;

  const today: HubRow[] = canDrive
    ? [
        { key: 'checkin', icon: 'shield', title: t('partner.hub_checkin'), subtitle: t('partner.hub_checkin_sub'), href: '/checkin', pill: checkInPill(checkIn, t) },
        { key: 'documents', icon: 'receipt', title: t('partner.hub_documents'), subtitle: t('partner.hub_documents_sub'), href: '/documents', pill: papersPill(docs, t) },
      ]
    : [];
  const you: HubRow[] = [
    {
      key: 'scorecard',
      icon: 'star',
      title: t('partner.hub_scorecard'),
      // a4: the number and what costs him most, right on the row.
      subtitle:
        card?.visible && card.index !== null
          ? weak
            ? t('partner.a1_score_sub_weak', { index: card.index, part: t(METRIC_NAME[weak.key]) })
            : t('partner.a1_score_sub', { index: card.index })
          : t('partner.hub_scorecard_sub'),
      href: '/scorecard',
    },
    { key: 'compliments', icon: 'heart', title: t('partner.compliments_title'), subtitle: t('partner.compliments_row_sub'), href: '/compliments' },
  ];
  const more: HubRow[] = [
    { key: 'intercity', icon: 'garage', title: t('partner.hub_intercity'), subtitle: t('partner.hub_intercity_sub'), href: '/intercity', mode: 'intercity' },
    { key: 'khat', icon: 'seat', title: t('partner.hub_khat'), subtitle: t('partner.hub_khat_sub'), href: '/khat', mode: 'khat' },
    { key: 'fleet', icon: 'car', title: t('partner.hub_fleet'), subtitle: t('partner.hub_fleet_sub'), href: '/fleet', mode: 'fleet' },
    { key: 'ops', icon: 'map-pin', title: t('partner.hub_ops'), subtitle: t('partner.hub_ops_sub'), href: '/ops', mode: 'ops' },
  ].filter((r) => !r.mode || modes.includes(r.mode as PartnerMode)) as HubRow[];

  const testSound = async () => {
    const ok = await playTestSound();
    if (!ok) toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' });
  };

  const signOut = async () => {
    const refreshToken = session.getSnapshot().session?.refreshToken;
    await unregisterPush(client);
    await client.identity.logout.mutate(refreshToken ? { refreshToken } : {}).catch(() => undefined);
    await session.signOut();
  };

  return (
    <Screen testID="account-tab">
      <Text variant="heading" accessibilityRole="header">
        {t('partner.account_title')}
      </Text>

      {/* a2: his approved photo — the one customers see — not a drawn avatar; his initial until there is one. */}
      <Card elevation={1} padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          <Avatar name={me?.name ?? undefined} {...(me?.name || photoUri ? {} : { icon: 'user' as const })} uri={photoUri} size={72} tone="accent" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" weight={700}>
              {me?.name ?? '—'}
            </Text>
            <Text variant="label" color="textMuted" tabular>
              {me ? `⁦${me.phoneMasked}⁩` : ''}
            </Text>
            <View style={{ flexDirection: 'row', marginTop: theme.space[1] }}>
              <StatusPill label={t(`partner.tier_${tier}`)} tone={tier === 'gold' ? 'accent' : tier === 'silver' ? 'info' : 'neutral'} icon="star" size="sm" />
            </View>
          </View>
        </View>
      </Card>

      {invites.pending.map((i) => (
        <FleetInviteCard key={i.fleetOrgId} invite={i} />
      ))}
      {invites.member.map((i) => (
        <FleetMemberCard key={i.fleetOrgId} invite={i} />
      ))}

      {today.length > 0 ? <Section testID="hub-today" title={t('partner.a1_today')} rows={today} /> : null}

      <View testID="hub-you" style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
          {t('partner.a1_me')}
        </Text>
        <Card elevation={0} padding={0}>
          {/* r4: the page a rider opens on his photo, as they see it. */}
          <ListRow testID="hub-seen" leading="star" title={t('partner.seen_title')} subtitle={t('partner.seen_row_sub')} onPress={() => router.push('/seen')} divider />
          <ListRow
            testID="hub-photo"
            leading="user"
            title={t('partner.mainphoto_row')}
            subtitle={photo?.state === 'rejected' && photo.latest?.rejectReason ? mainPhotoStatus(photo, t).label : t('partner.mainphoto_intro')}
            trailing={photo ? <StatusPill size="sm" tone={photoState.tone} label={photoState.label} /> : undefined}
            onPress={() => router.push('/photo')}
            divider
          />
          {features ? (
            <ListRow
              testID="hub-vehicle-features"
              leading={vehicle?.vehicleClass === 'tuktuk' ? 'tuktuk' : 'car'}
              title={t('partner.features_title')}
              subtitle={
                features.confirmed.length > 0
                  ? t('partner.features_row_seen', { names: features.confirmed.map((f) => t(featureKey(f))).join('، ') })
                  : t(features.pending.length > 0 ? 'partner.features_row_waiting' : 'partner.features_row_none')
              }
              trailing={features.pending.length > 0 ? <StatusPill size="sm" tone="neutral" icon="clock" label={t('partner.features_pending')} /> : undefined}
              onPress={() => router.push('/vehicle')}
              divider
            />
          ) : null}
          {you.map((r, i) => (
            <HubListRow key={r.key} r={r} divider={i < you.length - 1} />
          ))}
        </Card>
      </View>

      {more.length > 0 ? <Section testID="hub-other" title={t('partner.a1_other_work')} rows={more} /> : null}

      {/* Help and settings: who SOS tells, "جرّب صوت الطلب" (S-01), the order read aloud (o4), the map app (d3), low data (q2).
          «شغّل» is the one tap target on the sound row: the row itself is not a button, so no button sits inside a button. */}
      <View testID="hub-help" style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
          {t('partner.a1_help')}
        </Text>
        <Card elevation={0} padding={0}>
          {/* The SOS button messages this person (scoring & safety §3); shows who it is once set. */}
          <ListRow
            testID="hub-emergency"
            leading="sos"
            title={t('partner.ec_row')}
            subtitle={contact ? `${contact.name} · \u2066${contact.phoneMasked}\u2069` : t('partner.ec_row_hint')}
            onPress={() => router.push('/emergency')}
            divider
          />
          <ListRow
            testID="test-sound"
            leading="bell"
            title={t('partner.test_sound')}
            subtitle={t('partner.test_sound_sub')}
            chevron={false}
            trailing={<Button testID="test-sound-play" label={t('partner.test_sound_play')} icon="bell" variant="secondary" size="sm" onPress={() => void testSound()} />}
            divider
          />
          <ListRow
            testID="speak-offers"
            leading="volume"
            title={t('partner.speak_setting')}
            subtitle={t('partner.speak_setting_sub')}
            chevron={false}
            trailing={
              <Switch
                testID="speak-offers-switch"
                value={speak.on}
                onValueChange={(v) => void setSpeakOffers(v)}
                accessibilityLabel={t('partner.speak_setting')}
                trackColor={{ false: theme.colors.borderStrong, true: theme.colors.accent }}
                thumbColor={theme.colors.surface}
              />
            }
            divider
          />
          <ListRow testID="nav-app" leading="map-pin" title={t('partner.nav_setting')} subtitle={nav.app ? t(navAppName(nav.app)) : t('partner.nav_setting_none')} onPress={() => setChoosingNav(true)} />
        </Card>
      </View>
      <DataSaverCard onChange={(p) => void saveDataSaverPref(p)} />
      <NavChooser
        visible={choosingNav}
        current={nav.app}
        onClose={() => setChoosingNav(false)}
        onPick={(app) => {
          setChoosingNav(false);
          void setNavApp(app);
        }}
      />

      <Button testID="sign-out" label={t('partner.sign_out')} variant="ghost" fullWidth onPress={() => void signOut()} />
    </Screen>
  );
}

function HubListRow({ r, divider }: { r: HubRow; divider: boolean }) {
  return (
    <ListRow
      testID={`hub-${r.key}`}
      leading={r.icon}
      title={r.title}
      subtitle={r.subtitle}
      trailing={r.pill ? <StatusPill size="sm" tone={r.pill.tone} label={r.pill.label} /> : undefined}
      divider={divider}
      onPress={() => router.push(r.href)}
    />
  );
}

function Section({ title, rows, testID }: { title: string; rows: HubRow[]; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
        {title}
      </Text>
      <Card elevation={0} padding={0}>
        {rows.map((r, i) => (
          <HubListRow key={r.key} r={r} divider={i < rows.length - 1} />
        ))}
      </Card>
    </View>
  );
}
