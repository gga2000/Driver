import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { SavedPlaceView } from '@driver/contracts';
import { settleWithin } from '@driver/contracts/net-client';
import { Avatar, Button, Card, Icon, ListRow, PhotoImage, QueryBoundary, SegmentedControl, Skeleton, StatusPill, Text, Toggle, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { photoUri } from '@/features/account/device';
import { MonthCard } from '@/features/account/MonthCard';
import { useGuardianChildren, useHousehold, useMe, useMyPlaces, useSavedPeople, useWalletBalance } from '@/features/account/queries';
import { amountParam } from '@/lib/money';
import { unregisterPush } from '@/features/notify/usePush';
import { placeIcon } from '@/features/places/place-icon';
import { useSimpleMode } from '@/features/simple/pref';
import { useApiClient } from '@/lib/api';
import { useInviteRule } from '@/features/invite/queries';
import { useLocale, useT } from '@/lib/i18n';
import { profile, useProfile, type AppLocale } from '@/lib/profile';
import { GuestGate } from '@/components/GuestGate';
import { session, useSignedIn } from '@/lib/session';

/** Sign-out waits this long at most for the server to hear about it. */
const SIGN_OUT_WAIT_MS = 4_000;

/**
 * حسابي (customer spec §10): who you are (name from the vault), saved places with their gate
 * photos and the "موقعك مؤكد ✓" badge, people you order for, safety, notifications, language,
 * sign out.
 */
/** Guests see what lives here and add their number (audit C-18). */
export default function AccountTab() {
  return useSignedIn() ? <Account /> : <GuestGate kind="account" />;
}

function Account() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const prof = useProfile();
  const me = useMe();
  // THIN-18: «عزّم صديقك» promises points, so it shows only while the server pays them.
  const inviteRule = useInviteRule();
  const places = useMyPlaces();
  const people = useSavedPeople();
  const household = useHousehold();
  const children = useGuardianChildren();
  // w10: the header knows you — your points and what you saved this year (both from the server).
  const wallet = useWalletBalance().data;
  const [signingOut, setSigningOut] = useState(false);
  const simple = useSimpleMode();
  const name = me.data?.name ?? prof.name ?? null;

  const signOut = async () => {
    setSigningOut(true);
    const refreshToken = session.getSnapshot().session?.refreshToken;
    // Best effort, bounded: drop this phone's push token and revoke server-side (which also drops the
    // session's tokens), then forget everything on this device regardless. A bad network never keeps
    // someone signed in (audit CORE-15).
    const farewell = Promise.allSettled([
      unregisterPush(client),
      client.identity.logout.mutate(refreshToken ? { refreshToken } : {}),
    ]);
    await settleWithin(farewell, SIGN_OUT_WAIT_MS);
    await profile.reset();
    await session.signOut();
  };

  // Ride idea v2: turning it on opens the simple home at once, so whoever set it up sees what changed.
  const toggleSimple = (on: boolean) => {
    void simple.set(on);
    toast.show({ message: t(on ? 'account.simple_on' : 'account.simple_off'), tone: 'success', icon: 'check' });
    if (on) router.replace('/simple');
  };

  const changeLocale = (next: AppLocale) => {
    if (next === locale) return;
    void profile.setLocale(next);
    if (Platform.OS !== 'web') toast.show({ message: t('account.language_restart'), tone: 'info' });
  };

  const placeList = places.data ?? [];
  // w9: the safety row names the trusted people and says when sharing is on.
  const trusted = me.data?.trustedContacts ?? [];
  const sharing = Boolean(me.data?.safety.autoShareRajaa || me.data?.safety.autoShareNight || me.data?.safety.notifyOnArrival);

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
        {wallet && (wallet.points > 0 || wallet.savedThisYearIqd > 0) ? (
          <Pressable
            testID="account-wallet-strip"
            accessibilityRole="button"
            onPress={() => router.push('/wallet')}
            style={({ pressed }) => ({ marginTop: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44, paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border, opacity: pressed ? 0.7 : 1 })}
          >
            {wallet.points > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingVertical: 4, paddingHorizontal: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: theme.colors.deal }}>
                <Icon name="star" size={14} color="onDeal" filled fillColor="onDeal" />
                <Text variant="label" weight={700} color="onDeal" tabular>
                  {t('account.points_pill', { n: amountParam(wallet.points) })}
                </Text>
              </View>
            ) : null}
            <Text variant="footnote" color={wallet.savedThisYearIqd > 0 ? 'successText' : 'textMuted'} weight={wallet.savedThisYearIqd > 0 ? 600 : 400} style={{ flex: 1 }}>
              {wallet.savedThisYearIqd > 0 ? t('account.saved_this_year', { amount: amountParam(wallet.savedThisYearIqd) }) : t('account.see_wallet')}
            </Text>
            <Icon name="chevron-forward" size={18} color="textMuted" />
          </Pressable>
        ) : null}
      </Card>

      {/* Joy w6: «شهرك» — the month-start card on the 1st–3rd, the row any day. */}
      <MonthCard testID="account-month-card" />
      <Card elevation={0} padding={0}>
        <ListRow testID="account-month" leading="star" title={t('month.row_title')} subtitle={t('month.row_sub')} onPress={() => router.push('/month')} />
      </Card>

      {/* Joy J7d: the rides taken every week, and the drivers asked for first. */}
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('habits.account_section')} />
        <Card elevation={0} padding={0}>
          <ListRow testID="account-regular" leading="refresh" title={t('habits.regular_title')} subtitle={t('habits.regular_row_sub')} onPress={() => router.push('/regular')} divider />
          <ListRow testID="account-drivers" leading="heart" title={t('habits.fav_title')} subtitle={t('habits.fav_row_sub')} onPress={() => router.push('/drivers')} />
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.places')} action={{ label: t('home.add_place'), onPress: () => router.push('/places/new') }} />
        {/* W8: a failed read is never "no saved places" (or "nobody yet" below): it says so, with a retry. */}
        <QueryBoundary
          query={places}
          size="inline"
          staleNote={false}
          locale={locale}
          testID="account-places-state"
          skeleton={
            <Card elevation={0} padding={4}>
              <View style={{ gap: theme.space[3] }}>
                <Skeleton height={44} />
                <Skeleton height={44} />
              </View>
            </Card>
          }
        >
          {() => (
            <Card elevation={0} padding={0}>
              {placeList.length === 0 ? (
                <ListRow leading="map-pin" title={t('empty.saved_places')} subtitle={t('onboarding.place_hint')} onPress={() => router.push('/places/new')} />
              ) : (
                placeList.map((p, i) => <PlaceRow key={p.id} place={p} divider={i < placeList.length - 1} />)
              )}
            </Card>
          )}
        </QueryBoundary>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.people')} />
        <QueryBoundary query={people} size="inline" staleNote={false} locale={locale} testID="account-people-state" skeleton={<Skeleton height={64} />}>
          {(saved) => (
            <Card elevation={0} padding={0}>
              {saved.length === 0 ? (
                <ListRow leading="user" title={t('account.people_empty')} subtitle={t('account.people_hint')} chevron={false} />
              ) : (
                saved.slice(0, 6).map((p, i, list) => (
                  <ListRow key={p.key} leading={<Avatar name={p.name} size={40} />} title={p.name} subtitle={t('account.people_last', { role: t(p.role === 'rider' ? 'account.people_role_rider' : 'account.people_role_recipient') })} chevron={false} divider={i < list.length - 1} />
                ))
              )}
            </Card>
          )}
        </QueryBoundary>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.safety')} />
        <Card elevation={0} padding={0}>
          <ListRow
            testID="account-emergency"
            leading="shield"
            title={t('account.safety')}
            subtitle={
              trusted.length > 0
                ? [t('account.safety_people', { names: trusted.map((p) => p.name).join('، ') }), sharing ? t('account.safety_sharing_on') : null].filter(Boolean).join(' · ')
                : t('account.emergency_hint')
            }
            // «أضف» only once the server said there is nobody yet; a failed read never claims the list is empty.
            value={me.isSuccess && trusted.length === 0 ? t('account.add') : undefined}
            onPress={() => router.push('/profile/safety')}
            divider
          />
          <ListRow
            testID="account-household"
            leading="family"
            title={t('household.title')}
            subtitle={household.isSuccess ? (household.data ? t('account.household_members', { n: household.data.members.length }) : t('account.household_hint')) : undefined}
            onPress={() => router.push('/household')}
            divider
          />
          {/* خطوط children's photos (Ali, 2026-10-06): only for guardians with a child registered. */}
          {children.isSuccess && children.data.length > 0 ? (
            <ListRow testID="account-children" leading="user" title={t('household.children_title')} subtitle={t('household.children_row_sub')} onPress={() => router.push('/household/children')} divider />
          ) : null}
          <ListRow testID="account-notifications" leading="bell" title={t('account.notifications')} subtitle={t('account.notifications_hint')} onPress={() => router.push('/profile/notifications')} />
        </Card>
      </View>

      {/* Joy g2 and g7: treat a friend (the referral as a gift) and the sticker pack. */}
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.share_section')} />
        <Card elevation={0} padding={0}>
          {inviteRule.isSuccess && inviteRule.data.rewardsOn ? (
            <ListRow testID="account-invite" leading="gift" title={t('account.invite_row')} subtitle={t('account.invite_row_hint')} onPress={() => router.push('/invite')} divider />
          ) : null}
          <ListRow testID="account-stickers" leading="heart" title={t('account.stickers_row')} subtitle={t('account.stickers_row_hint')} onPress={() => router.push('/stickers')} />
        </Card>
      </View>

      {/* Help (audit C-13): a problem with an order, the WhatsApp line, common questions. */}
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.help_section')} />
        <Card elevation={0} padding={0}>
          <ListRow testID="account-help" leading="chat" title={t('account.help_row')} subtitle={t('account.help_row_hint')} onPress={() => router.push('/help')} />
        </Card>
      </View>

      {/* Ride idea v2: «الوضع البسيط» — bigger text, fewer choices, one big «رجعني للبيت». */}
      <Card elevation={0} padding={0}>
        <ListRow
          testID="account-simple"
          leading="bulb"
          title={t('account.simple_title')}
          subtitle={t('account.simple_hint')}
          chevron={false}
          trailing={
            <Toggle
              testID="account-simple-switch"
              accessibilityLabel={t('account.simple_title')}
              value={simple.on}
              onValueChange={toggleSimple}
            />
          }
        />
      </Card>

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
  const icon = placeIcon(place.label);
  const leading = photo ? (
    <PhotoImage uri={photoUri(photo.url)} style={{ width: 44, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} />
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
