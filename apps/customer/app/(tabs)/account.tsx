import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import type { SavedPlaceView } from '@driver/contracts';
import { Avatar, Button, Card, Chip, Icon, ListRow, SegmentedControl, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { photoUri } from '@/features/account/device';
import { useHousehold, useMe, useMyPlaces, useSavedPeople } from '@/features/account/queries';
import { unregisterPush } from '@/features/notify/usePush';
import { useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile, useProfile, type AppLocale } from '@/lib/profile';
import { session } from '@/lib/session';

/**
 * حسابي (customer spec §10): who you are (name from the vault), saved places with their gate
 * photos and the "موقعك مؤكد ✓" badge, people you order for, safety, notifications, language,
 * sign out.
 */
export default function Account() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const prof = useProfile();
  const me = useMe();
  const places = useMyPlaces();
  const people = useSavedPeople();
  const household = useHousehold();
  const [signingOut, setSigningOut] = useState(false);
  const name = me.data?.name ?? prof.name ?? null;

  const signOut = async () => {
    setSigningOut(true);
    const refreshToken = session.getSnapshot().session?.refreshToken;
    // Best effort: drop this phone's push token, revoke server-side (which also drops the session's
    // tokens), then forget everything on this device regardless.
    await unregisterPush(client);
    await client.identity.logout.mutate(refreshToken ? { refreshToken } : {}).catch(() => undefined);
    await profile.reset();
    await session.signOut();
  };

  const changeLocale = (next: AppLocale) => {
    if (next === locale) return;
    void profile.setLocale(next);
    if (Platform.OS !== 'web') toast.show({ message: t('account.language_restart'), tone: 'info' });
  };

  const placeList = places.data ?? [];
  const contact = me.data?.emergencyContact ?? null;

  return (
    <Screen testID="account">
      <Text variant="heading" accessibilityRole="header">
        {t('nav.account')}
      </Text>

      <Card padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          <Avatar name={name ?? '?'} icon={name ? undefined : 'user'} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            {me.isPending && !name ? (
              <Skeleton height={18} width="50%" />
            ) : (
              <Text variant="title" numberOfLines={1}>
                {name ?? t('account.no_name')}
              </Text>
            )}
            {me.data ? (
              <Text variant="footnote" color="textMuted" tabular>
                {`⁦${me.data.phoneMasked}⁩`}
              </Text>
            ) : null}
          </View>
          <Button testID="account-edit-name" size="sm" variant="secondary" label={name ? t('action.edit') : t('account.set_name')} onPress={() => router.push('/profile/name')} />
        </View>
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.places')} action={{ label: t('home.add_place'), onPress: () => router.push('/places/new') }} />
        <Card elevation={0} padding={0}>
          {places.isPending ? (
            <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
            </View>
          ) : placeList.length === 0 ? (
            <ListRow leading="map-pin" title={t('empty.saved_places')} subtitle={t('onboarding.place_hint')} onPress={() => router.push('/places/new')} />
          ) : (
            placeList.map((p, i) => <PlaceRow key={p.id} place={p} divider={i < placeList.length - 1} />)
          )}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.people')} />
        <Card elevation={0} padding={0}>
          {(people.data ?? []).length === 0 ? (
            <ListRow leading="user" title={t('account.people_empty')} subtitle={t('account.people_hint')} chevron={false} />
          ) : (
            (people.data ?? []).slice(0, 6).map((p, i, list) => (
              <ListRow key={p.key} leading={<Avatar name={p.name} size={40} />} title={p.name} subtitle={t('account.people_last', { role: t(p.role === 'rider' ? 'account.people_role_rider' : 'account.people_role_recipient') })} chevron={false} divider={i < list.length - 1} />
            ))
          )}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.safety')} />
        <Card elevation={0} padding={0}>
          <ListRow
            testID="account-emergency"
            leading="shield"
            title={t('account.emergency_contact')}
            subtitle={contact ? `${contact.name} · ⁦${contact.phoneMasked}⁩` : t('account.emergency_hint')}
            value={contact ? undefined : t('account.add')}
            onPress={() => router.push('/profile/safety')}
            divider
          />
          <ListRow
            leading="user"
            title={t('household.title')}
            subtitle={household.data ? t('account.household_members', { n: household.data.members.length }) : t('account.household_hint')}
            onPress={() => router.push('/household')}
            divider
          />
          <ListRow testID="account-notifications" leading="bell" title={t('account.notifications')} subtitle={t('account.notifications_hint')} onPress={() => router.push('/profile/notifications')} />
        </Card>
        <Chip
          testID="account-share-trips"
          role="checkbox"
          icon="share"
          selected={prof.shareTripsByDefault}
          label={t('account.share_trips')}
          onPress={() => void profile.setShareTripsByDefault(!prof.shareTripsByDefault)}
        />
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.language')} />
        <SegmentedControl<AppLocale>
          accessibilityLabel={t('account.language')}
          value={locale}
          onChange={changeLocale}
          options={[
            { value: 'ar-IQ', label: t('account.lang_ar') },
            { value: 'en', label: t('account.lang_en') },
          ]}
        />
      </View>

      <View style={{ gap: theme.space[2], paddingTop: theme.space[2] }}>
        <Button testID="sign-out" variant="secondary" label={t('account.sign_out')} fullWidth loading={signingOut} onPress={() => void signOut()} />
        <Text variant="caption" color="textMuted" align="center">
          {t('account.sign_out_body')}
        </Text>
      </View>
    </Screen>
  );
}

/** A saved place: gate photo (or the label's icon), name, zone and note, the confirmed badge. */
function PlaceRow({ place, divider }: { place: SavedPlaceView; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const photo = place.photos[0];
  const icon = place.label === 'home' ? 'home' : place.label === 'work' ? 'bag' : 'map-pin';
  const leading = photo ? (
    <Image source={{ uri: photoUri(photo.url) }} style={{ width: 44, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} accessibilityIgnoresInvertColors />
  ) : (
    <View style={{ width: 44, height: 44, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
      <Icon name={icon} size={20} color="textMuted" />
    </View>
  );
  const zone = locale === 'en' ? place.zoneName_en : place.zoneName_ar;
  return (
    <ListRow
      testID={`place-${place.id}`}
      leading={leading}
      title={place.name}
      subtitle={[zone, place.note].filter(Boolean).join(' · ')}
      trailing={
        place.confirmed ? (
          <StatusPill size="sm" tone="success" label={t('place.confirmed_badge')} />
        ) : place.access === 'household' ? (
          <StatusPill size="sm" tone="info" label={t('place.from_household')} />
        ) : undefined
      }
      onPress={() => router.push({ pathname: '/places/edit', params: { id: place.id } })}
      divider={divider}
    />
  );
}
