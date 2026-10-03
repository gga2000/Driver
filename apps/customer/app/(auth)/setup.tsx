import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, TextField, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { EMPTY_PLACE, PlaceForm, type PlaceDraft } from '@/features/places/PlaceForm';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';

/**
 * Post-OTP setup: "شنو نسميك؟" then the first saved place. Both are optional — "تخطي" finishes
 * setup and the guard sends the person home. TODO(api): send the name to the server once
 * `identity.updateProfile` exists (stored on the device until then, see lib/profile.ts).
 */
export default function Setup() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const signedIn = useSignedIn();
  const me = useQuery({ ...api.identity.me.queryOptions(), enabled: signedIn });
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(profile.getSnapshot().name ?? '');
  const [place, setPlace] = useState<PlaceDraft>(EMPTY_PLACE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me.data?.name && !name) setName(me.data.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.name]);

  const finish = async (withPlace: boolean) => {
    setSaving(true);
    if (name.trim()) await profile.setName(name);
    if (withPlace && place.zoneId) await profile.addPlace({ ...place, note: place.note?.trim() || undefined });
    await profile.setSetupPending(false); // the guard takes it from here
  };

  const footer =
    step === 1 ? (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="setup-next" label={t('action.next')} size="lg" fullWidth disabled={!name.trim()} onPress={() => setStep(2)} />
        <Button testID="setup-skip" variant="ghost" label={t('action.skip')} fullWidth onPress={() => void finish(false)} />
      </View>
    ) : (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="setup-save" label={t('action.save')} size="lg" fullWidth disabled={!place.zoneId} loading={saving} onPress={() => void finish(true)} />
        <Button testID="setup-skip-place" variant="ghost" label={t('action.skip')} fullWidth onPress={() => void finish(false)} />
      </View>
    );

  return (
    <Screen footer={footer}>
      {step === 1 ? (
        <>
          <AuthHeader back={false} title={t('onboarding.name_title')} aside={t('onboarding.setup_step', { step: 1, total: 2 })} />
          <TextField
            testID="setup-name"
            value={name}
            onChangeText={setName}
            placeholder={t('onboarding.name_placeholder')}
            hint={t('onboarding.name_hint')}
            autoFocus
            autoComplete="name"
            textContentType="givenName"
            leadingIcon="user"
            returnKeyType="next"
            onSubmitEditing={() => name.trim() && setStep(2)}
            maxLength={60}
          />
        </>
      ) : (
        <>
          <AuthHeader onBack={() => setStep(1)} title={t('onboarding.place_title')} aside={t('onboarding.setup_step', { step: 2, total: 2 })} />
          <PlaceForm value={place} onChange={setPlace} />
        </>
      )}
    </Screen>
  );
}
