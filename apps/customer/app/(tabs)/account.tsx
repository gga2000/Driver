import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Avatar, Button, Card, ListRow, SegmentedControl, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useApi, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile, useProfile, zoneName, type AppLocale } from '@/lib/profile';
import { session, useSignedIn } from '@/lib/session';

/** حسابي (spec §10, shell slice): who you are, saved places, language, sign out. */
export default function Account() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const api = useApi();
  const client = useApiClient();
  const prof = useProfile();
  const signedIn = useSignedIn();
  const me = useQuery({ ...api.identity.me.queryOptions(), enabled: signedIn });
  const [signingOut, setSigningOut] = useState(false);
  const name = prof.name ?? me.data?.name ?? null;

  const signOut = async () => {
    setSigningOut(true);
    const refreshToken = session.getSnapshot().session?.refreshToken;
    // Best effort: revoke server-side, then forget everything on this device regardless.
    await client.identity.logout.mutate(refreshToken ? { refreshToken } : {}).catch(() => undefined);
    await profile.reset();
    await session.signOut();
  };

  const changeLocale = (next: AppLocale) => {
    if (next === locale) return;
    void profile.setLocale(next);
    if (Platform.OS !== 'web') toast.show({ message: t('account.language_restart'), tone: 'info' });
  };

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
          {!name ? <Button size="sm" variant="secondary" label={t('account.set_name')} onPress={() => void profile.setSetupPending(true)} /> : null}
        </View>
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('account.places')} action={{ label: t('home.add_place'), onPress: () => router.push('/places/new') }} />
        <Card elevation={0} padding={0}>
          {prof.places.length === 0 ? (
            <ListRow leading="map-pin" title={t('empty.saved_places')} subtitle={t('onboarding.place_hint')} onPress={() => router.push('/places/new')} />
          ) : (
            prof.places.map((p, i) => (
              <ListRow
                key={p.id}
                testID={`place-${p.id}`}
                leading={p.label === 'home' ? 'home' : p.label === 'work' ? 'bag' : 'map-pin'}
                title={p.title ?? t(placeLabelKey(p.label))}
                subtitle={[zoneName(p.zoneId, locale), p.note].filter(Boolean).join(' · ')}
                selected={p.id === prof.selectedPlaceId}
                divider={i < prof.places.length - 1}
                onPress={() => void profile.selectPlace(p.id)}
              />
            ))
          )}
        </Card>
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
