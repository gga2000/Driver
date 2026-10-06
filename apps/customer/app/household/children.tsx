import { useState } from 'react';
import { View } from 'react-native';
import type { GuardianChild } from '@driver/contracts';
import { Avatar, Button, Card, EmptyState, ModalSheet, Skeleton, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { pickGatePhoto, uploadPhoto, type PhotoSource } from '@/features/account/device';
import { useChildPhotoMutations, useGuardianChildren } from '@/features/account/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';

/**
 * أطفال الخطوط (Ali, 2026-10-06): a guardian's own خطوط children and the photo he may add of each.
 * The photo is seen ONLY by the driver of the child's run (and a substitute driving it), never on a
 * share link; he can delete it at any time (it is deleted from storage). Without one the driver sees
 * the initial.
 */
export default function Children() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const q = useGuardianChildren();
  const net = useNetwork();
  const [removing, setRemoving] = useState<GuardianChild | null>(null);
  const m = useChildPhotoMutations();
  const toast = useToast();

  const remove = async () => {
    if (!removing) return;
    try {
      await m.remove.mutateAsync({ childRef: removing.childRef });
      toast.show({ message: t('household.child_photo_removed'), tone: 'success' });
      setRemoving(null);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('household.child_photo_failed'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen edges={['bottom']} testID="household-children">
      <Text variant="body" color="textMuted">
        {t('household.children_intro')}
      </Text>
      {!net.online ? (
        <Text testID="children-offline" variant="footnote" color="warningText">
          {t('household.child_offline')}
        </Text>
      ) : null}
      {q.isPending ? (
        <Card padding={4}>
          <Skeleton lines={3} />
        </Card>
      ) : q.error ? (
        <EmptyState icon="user" title={apiErrorMessage(q.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void q.refetch() }} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon="user" title={t('household.children_empty_title')} body={t('household.children_empty_body')} />
      ) : (
        (q.data ?? []).map((c) => <ChildCard key={c.childRef} child={c} online={net.online} onRemove={() => setRemoving(c)} />)
      )}
      <ModalSheet
        visible={removing !== null}
        onClose={() => (m.remove.isPending ? undefined : setRemoving(null))}
        locked={m.remove.isPending}
        title={removing ? t('household.child_remove_title', { name: removing.name }) : undefined}
        testID="child-remove-sheet"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="child-remove-confirm" variant="destructive" label={t('household.child_remove_photo')} loading={m.remove.isPending} disabled={!net.online} fullWidth onPress={() => void remove()} />
            <Button label={t('action.cancel')} variant="ghost" fullWidth disabled={m.remove.isPending} onPress={() => setRemoving(null)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('household.child_remove_body')}
        </Text>
      </ModalSheet>
    </Screen>
  );
}

function ChildCard({ child, online, onRemove }: { child: GuardianChild; online: boolean; onRemove: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const m = useChildPhotoMutations();
  const [busy, setBusy] = useState(false);
  const uri = apiPhoto(child.photoUrl);

  const add = async (source: PhotoSource) => {
    const picked = await pickGatePhoto(source);
    if (picked === 'denied') {
      toast.show({ message: t('error.camera_denied'), tone: 'danger' });
      return;
    }
    if (!picked) return;
    setBusy(true);
    try {
      const uploadId = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
      await m.set.mutateAsync({ childRef: child.childRef, uploadId });
      toast.show({ message: t('household.child_photo_saved'), tone: 'success' });
    } catch (err) {
      toast.show({ message: err instanceof Error && /^(upload_|photo_size)/.test(err.message) ? t('household.child_photo_failed') : apiErrorMessage(err, t('household.child_photo_failed'), locale), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={4} testID={`child-${child.childRef}`}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={child.name} uri={uri ?? undefined} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title">{child.name}</Text>
            <Text variant="footnote" color="textMuted">
              {uri ? t('household.child_has_photo') : t('household.child_no_photo')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Button
            testID={`child-photo-camera-${child.childRef}`}
            icon="camera"
            size="md"
            label={uri ? t('household.child_change_photo') : t('household.child_add_photo')}
            loading={busy}
            disabled={!online}
            onPress={() => void add('camera')}
          />
          <Button testID={`child-photo-library-${child.childRef}`} variant="secondary" size="md" label={t('household.child_pick_library')} disabled={!online || busy} onPress={() => void add('library')} />
          {uri ? <Button testID={`child-photo-remove-${child.childRef}`} variant="ghost" size="md" label={t('household.child_remove_photo')} disabled={!online || busy} onPress={onRemove} /> : null}
        </View>
      </View>
    </Card>
  );
}
