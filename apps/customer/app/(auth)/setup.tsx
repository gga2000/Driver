import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Button, TextField, useTheme, useToast } from '@driver/ui';
import { useMe, useSavePlace, useUpdateProfile } from '@/features/account/queries';
import { defaultPlaceName, EMPTY_PLACE_EDITOR, PlaceEditor, toSaveInput, type PlaceEditorValue } from '@/features/account/PlaceEditor';
import { AuthStage } from '@/features/auth/AuthStage';
import { apiErrorMessage } from '@/lib/api';
import { signInReason } from '@/lib/guard';
import { useLocale, useT } from '@/lib/i18n';
import { profile, useProfile } from '@/lib/profile';

/**
 * Post-OTP setup, step 3 of the golden sheet: «هلا بيك · وين نوصلك؟» on one screen, the name the
 * courier calls out and the first place (map, «موقعي», what it is, a note). Both stay optional:
 * «بعدين» finishes setup and the guard takes the person on (back to the basket when one waits). The
 * name goes to the identity vault (`identity.updateProfile`), the place to `places.save`.
 */
export default function Setup() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const savePlace = useSavePlace();
  const reason = signInReason(useProfile().returnTo);
  // On a short phone the map matters more here than the basket, which the next screen shows anyway.
  const short = useWindowDimensions().height < 700;
  const [name, setName] = useState(profile.getSnapshot().name ?? '');
  const [place, setPlace] = useState<PlaceEditorValue>(() => ({ ...EMPTY_PLACE_EDITOR, name: defaultPlaceName('home', t) }));
  const [saving, setSaving] = useState<'place' | 'later' | null>(null);
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

  const finish = async (withPlace: boolean) => {
    setSaving(withPlace ? 'place' : 'later');
    await saveName();
    if (withPlace && input) {
      try {
        const saved = await savePlace.mutateAsync(input);
        await profile.selectPlace(saved.id);
      } catch (err) {
        setSaving(null);
        toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
        return;
      }
    }
    await profile.setSetupPending(false); // the guard takes it from here
  };

  return (
    <AuthStage
      step={3}
      back={false}
      title={t('auth.phone_title')}
      accent={t('onboarding.place_title')}
      ticket={reason === 'order' && !short}
      footer={
        <View style={{ gap: theme.space[1] }}>
          <Button
            testID="setup-save"
            label={t(reason === 'order' ? 'auth.setup_go_order' : 'auth.setup_go')}
            size="lg"
            fullWidth
            disabled={!input || saving !== null}
            loading={saving === 'place'}
            onPress={() => void finish(true)}
          />
          <Button testID="setup-skip" variant="ghost" label={t('auth.setup_later')} fullWidth loading={saving === 'later'} disabled={saving !== null} onPress={() => void finish(false)} />
        </View>
      }
    >
      <TextField
        testID="setup-name"
        label={t('onboarding.name_placeholder')}
        value={name}
        onChangeText={setName}
        placeholder={t('auth.name_placeholder')}
        hint={t('onboarding.name_hint')}
        autoComplete="name"
        textContentType="givenName"
        leadingIcon="user"
        returnKeyType="done"
        maxLength={60}
      />
      <PlaceEditor value={place} onChange={setPlace} first />
    </AuthStage>
  );
}
