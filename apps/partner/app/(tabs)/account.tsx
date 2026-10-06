import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { PartnerMode } from '@driver/contracts';
import { Avatar, Button, Card, DataSaverCard, ListRow, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { FleetInviteCard, FleetMemberCard } from '@/features/fleet/InviteParts';
import { splitInvites } from '@/features/fleet/logic';
import { useFleetInvites } from '@/features/fleet/queries';
import { unregisterPush } from '@/features/notify/Push';
import { navAppName, NavChooser } from '@/features/work/JobSheets';
import { setNavApp, useNavApp } from '@/features/work/nav';
import { useMe, useStatus } from '@/features/work/queries';
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

  const work: HubRow[] = [
    { key: 'checkin', icon: 'shield', title: t('partner.hub_checkin'), subtitle: t('partner.hub_checkin_sub'), href: '/checkin' },
    { key: 'documents', icon: 'receipt', title: t('partner.hub_documents'), subtitle: t('partner.hub_documents_sub'), href: '/documents' },
    { key: 'scorecard', icon: 'star', title: t('partner.hub_scorecard'), subtitle: t('partner.hub_scorecard_sub'), href: '/scorecard' },
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
          <Avatar name={me?.name ?? undefined} {...(me?.name ? {} : { icon: 'user' as const })} size={56} tone="accent" />
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

      <Section title={t('partner.hub_work')} rows={work} />
      {more.length > 0 ? <Section title={t('partner.hub_more')} rows={more} /> : null}

      {/* "جرّب صوت الطلب" (S-01): the real offer doorbell, so he knows it rings before the first offer. */}
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
            onPress={() => void testSound()}
            chevron={false}
            trailing={<Button testID="test-sound-play" label={t('partner.test_sound_play')} icon="bell" variant="secondary" size="sm" onPress={() => void testSound()} />}
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
