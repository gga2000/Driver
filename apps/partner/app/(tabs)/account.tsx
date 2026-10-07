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
import { mainPhotoStatus } from '@/features/account/logic';
import { absoluteUrl } from '@/features/account/photo';
import { useMainPhoto } from '@/features/account/queries';
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
}

/**
 * الحساب — the hub for everything that isn't the shift itself. Each row opens a wave-2 route
 * (documents, scorecard, daily check-in, garage board, khat runs, fleet, ops mode); rows for
 * modes the person doesn't hold are hidden.
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
  const invites = splitInvites(useFleetInvites(s?.canDrive ?? false).data ?? []);
  const contact = me?.emergencyContact ?? null;
  // His main photo (Ali, 2026-10-06): the approved one is what customers see; the row says where the latest stands.
  const photo = useMainPhoto().data;
  const photoState = mainPhotoStatus(photo, t, { short: true });
  const photoUri = photo?.approved ? absoluteUrl(photo.approved.url) : undefined;
  // «مميزات سيارتك» (ride step 3): for the car or tuktuk he drives; a bike has none.
  const vehicle = useMyVehicle(s?.canDrive ?? false).data;
  const features = vehicle && hasFeatures(vehicle.vehicleClass) ? featuresSummary(vehicle) : null;

  const work: HubRow[] = [
    { key: 'checkin', icon: 'shield', title: t('partner.hub_checkin'), subtitle: t('partner.hub_checkin_sub'), href: '/checkin' },
    { key: 'documents', icon: 'receipt', title: t('partner.hub_documents'), subtitle: t('partner.hub_documents_sub'), href: '/documents' },
    { key: 'scorecard', icon: 'star', title: t('partner.hub_scorecard'), subtitle: t('partner.hub_scorecard_sub'), href: '/scorecard' },
    { key: 'compliments', icon: 'heart', title: t('partner.compliments_title'), subtitle: t('partner.compliments_row_sub'), href: '/compliments' },
    // The SOS button messages this person (scoring & safety §3); shows who it is once set.
    { key: 'emergency', icon: 'sos', title: t('partner.ec_row'), subtitle: contact ? `${contact.name} · \u2066${contact.phoneMasked}\u2069` : t('partner.ec_row_hint'), href: '/emergency' },
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

      <Card elevation={1} padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={me?.name ?? undefined} {...(me?.name || photoUri ? {} : { icon: 'user' as const })} uri={photoUri} size={56} tone="accent" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title">{me?.name ?? '—'}</Text>
            <Text variant="label" color="textMuted" tabular>
              {me ? `⁦${me.phoneMasked}⁩` : ''}
            </Text>
          </View>
          <StatusPill label={t(`partner.tier_${tier}`)} tone={tier === 'gold' ? 'accent' : tier === 'silver' ? 'info' : 'neutral'} icon="star" size="sm" />
        </View>
      </Card>

      {invites.pending.map((i) => (
        <FleetInviteCard key={i.fleetOrgId} invite={i} />
      ))}
      {invites.member.map((i) => (
        <FleetMemberCard key={i.fleetOrgId} invite={i} />
      ))}

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
          divider={features !== null}
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
          />
        ) : null}
      </Card>

      <Section title={t('partner.hub_work')} rows={work} />
      {more.length > 0 ? <Section title={t('partner.hub_more')} rows={more} /> : null}

      {/* "جرّب صوت الطلب" (S-01): the real offer doorbell, so he knows it rings before the first offer.
          «شغّل» is the one tap target: the row itself is not a button, so no button sits inside a button. */}
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
          {t('partner.hub_alerts')}
        </Text>
        <Card elevation={0} padding={0}>
          <ListRow
            testID="test-sound"
            leading="bell"
            title={t('partner.test_sound')}
            subtitle={t('partner.test_sound_sub')}
            chevron={false}
            trailing={<Button testID="test-sound-play" label={t('partner.test_sound_play')} icon="bell" variant="secondary" size="sm" onPress={() => void testSound()} />}
            divider
          />
          {/* o4: the order read aloud as it lands, on by default. */}
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
          {/* Maps program d3: Google Maps or Waze for "الخريطة". */}
          <ListRow testID="nav-app" leading="map-pin" title={t('partner.nav_setting')} subtitle={nav.app ? t(navAppName(nav.app)) : t('partner.nav_setting_none')} onPress={() => setChoosingNav(true)} />
        </Card>
      </View>
      {/* Maps program q2: low-data mode. */}
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

function Section({ title, rows }: { title: string; rows: HubRow[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
        {title}
      </Text>
      <Card elevation={0} padding={0}>
        {rows.map((r, i) => (
          <ListRow key={r.key} testID={`hub-${r.key}`} leading={r.icon} title={r.title} subtitle={r.subtitle} divider={i < rows.length - 1} onPress={() => router.push(r.href)} />
        ))}
      </Card>
    </View>
  );
}
