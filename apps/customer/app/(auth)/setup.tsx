import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { useMe, useSavePlace, useUpdateProfile } from '@/features/account/queries';
import { defaultPlaceName, EMPTY_PLACE_EDITOR, PlaceEditor, toSaveInput, type PlaceEditorValue } from '@/features/account/PlaceEditor';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/**
 * Post-OTP setup: "شنو نسميك؟" then the first saved place. Both are optional — "تخطي" finishes
 * setup and the guard sends the person home. The name goes to the identity vault
 * (`identity.updateProfile`), the place to `places.save` (pin, note, gate photo).
 */
export default function Setup() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const savePlace = useSavePlace();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(profile.getSnapshot().name ?? '');
  const [place, setPlace] = useState<PlaceEditorValue>(() => ({ ...EMPTY_PLACE_EDITOR, name: defaultPlaceName('home', t) }));
  const [saving, setSaving] = useState(false);
  const input = toSaveInput(place, t);

  useEffect(() => {
    if (me.data?.name && !name) setName(me.data.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.name]);

  /** Name → vault (cached on the device for the greeting). A failed save keeps it on the device; sync retries. */
  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await profile.setName(trimmed);
    await updateProfile.mutateAsync({ name: trimmed }).catch(() => undefined);
  };

  const next = async () => {
    setSaving(true);
    await saveName();
    setSaving(false);
    setStep(2);
  };

  const finish = async (withPlace: boolean) => {
    setSaving(true);
    if (step === 1) await saveName();
    if (withPlace && input) {
      try {
        const saved = await savePlace.mutateAsync(input);
        await profile.selectPlace(saved.id);
      } catch (err) {
        setSaving(false);
        toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
        return;
      }
    }
    await profile.setSetupPending(false); // the guard takes it from here
  };

  const footer =
    step === 1 ? (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="setup-next" label={t('action.next')} size="lg" fullWidth disabled={!name.trim()} loading={saving} onPress={() => void next()} />
        <Button testID="setup-skip" variant="ghost" label={t('action.skip')} fullWidth onPress={() => void finish(false)} />
      </View>
    ) : (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="setup-save" label={t('action.save')} size="lg" fullWidth disabled={!input} loading={saving} onPress={() => void finish(true)} />
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
            onSubmitEditing={() => name.trim() && void next()}
            maxLength={60}
          />
        </>
      ) : (
        <>
          <AuthHeader onBack={() => setStep(1)} title={t('onboarding.place_title')} aside={t('onboarding.setup_step', { step: 2, total: 2 })} />
          <PlaceEditor value={place} onChange={setPlace} />
        </>
      )}
    </Screen>
  );
}
