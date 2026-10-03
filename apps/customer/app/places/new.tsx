import { router } from 'expo-router';
import { useState } from 'react';
import { Button, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useHousehold, useSavePlace } from '@/features/account/queries';
import { defaultPlaceName, EMPTY_PLACE_EDITOR, PlaceEditor, toSaveInput, type PlaceEditorValue } from '@/features/account/PlaceEditor';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/** Add a saved place (server-side, domain §7): pin, note, gate photo, household sharing. */
export default function NewPlace() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const household = useHousehold();
  const [value, setValue] = useState<PlaceEditorValue>(() => ({ ...EMPTY_PLACE_EDITOR, name: defaultPlaceName('home', t) }));
  const save = useSavePlace();
  const input = toSaveInput(value, t);

  const submit = async () => {
    if (!input) return;
    try {
      const saved = await save.mutateAsync(input);
      await profile.selectPlace(saved.id);
      toast.show({ message: t('place.saved'), tone: 'success' });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="place-new"
      footer={<Button testID="place-save" label={t('action.save')} size="lg" fullWidth disabled={!input} loading={save.isPending} onPress={() => void submit()} />}
    >
      <PlaceEditor value={value} onChange={setValue} canShare={Boolean(household.data)} />
    </Screen>
  );
}
