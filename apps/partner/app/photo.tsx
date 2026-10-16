import { Stack } from 'expo-router';
import { useState } from 'react';
import { Image, RefreshControl, View } from 'react-native';
import { Avatar, Button, Card, EmptyState, PhotoImage, Skeleton, StatusPill, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Glyph } from '@/features/account/Glyph';
import { mainPhotoNote, mainPhotoStatus } from '@/features/account/logic';
import { absoluteUrl, pickPhoto, uploadPhoto, type PickedPhoto, type PhotoSource } from '@/features/account/photo';
import { useAccountMutations, useMainPhoto, useRefreshAccount, useSetMainPhoto } from '@/features/account/queries';
import { useMe } from '@/features/work/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const FRAME = 220;

/**
 * صورتك الرئيسية (Ali, 2026-10-06): the one photo customers see on his card. Shows what they see now
 * (the approved photo, or his initial) and where his latest one stands — «تنتظر الموافقة» / «مقبولة» /
 * «مرفوضة: {reason}» — then camera or gallery with a face-framing circle, a preview, and "send for
 * approval" (`places.photoUpload` → `driverAccount.setMainPhoto`). The approved photo stays until a
 * new one is approved in the Console.
 */
export default function MainPhoto() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const me = useMe().data;
  const q = useMainPhoto();
  const m = useAccountMutations();
  const send = useSetMainPhoto();
  const refreshAccount = useRefreshAccount();
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const view = q.data;
  const status = mainPhotoStatus(view, t);
  const latestUrl = view?.latest && view.latest.status !== 'approved' && view.latest.url ? absoluteUrl(view.latest.url) : null;
  const approvedUrl = view?.approved ? absoluteUrl(view.approved.url) : null;

  const pick = async (source: PhotoSource) => {
    setError(null);
    const got = await pickPhoto(source, { selfie: true });
    if (got === 'denied') setError(t('partner.docs_camera_denied'));
    else if (got) setPicked(got);
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const uploadId = await uploadPhoto(picked, (input) => m.ticket.mutateAsync(input));
      await send.mutateAsync({ uploadId });
      theme.haptic('success');
      toast.show({ message: t('partner.mainphoto_sent'), tone: 'success', icon: 'check' });
      setPicked(null);
      await refreshAccount();
    } catch (err) {
      setError(err instanceof Error && /^(upload_|photo_size)/.test(err.message) ? t('partner.mainphoto_failed') : apiErrorMessage(err, t('partner.mainphoto_failed'), locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="main-photo"
      edges={['bottom']}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void q.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Stack.Screen options={{ title: t('partner.mainphoto_title') }} />
      {!view ? (
        q.error ? (
          <EmptyState icon="user" title={apiErrorMessage(q.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void q.refetch() }} />
        ) : (
          <Card elevation={1} padding={5}>
            <Skeleton lines={4} />
          </Card>
        )
      ) : (
        <>
          <Card elevation={1} padding={4} testID="main-photo-status">
            <View style={{ gap: theme.space[3] }}>
              <Text variant="body" color="textMuted">
                {t('partner.mainphoto_intro')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'flex-start' }}>
                <View testID="main-photo-current" style={{ alignItems: 'center', gap: theme.space[1] }}>
                  <Avatar name={me?.name ?? undefined} {...(me?.name ? {} : { icon: 'user' as const })} uri={approvedUrl ?? undefined} size={88} tone="accent" />
                  <Text variant="caption" color="textMuted">
                    {t('partner.mainphoto_current_label')}
                  </Text>
                </View>
                {latestUrl ? (
                  <View style={{ alignItems: 'center', gap: theme.space[1] }}>
                    <PhotoImage testID="main-photo-latest" uri={latestUrl} style={{ width: 88, height: 88, borderRadius: 44, opacity: view.state === 'rejected' ? 0.55 : 1, backgroundColor: theme.colors.surfaceSunken }} />
                    <Text variant="caption" color="textMuted">
                      {t('partner.mainphoto_new_label')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], alignItems: 'center' }}>
                <StatusPill size="sm" tone={status.tone} dot={view.state !== 'approved'} icon={view.state === 'approved' ? 'check' : undefined} label={view.state === 'rejected' ? t('partner.mainphoto_state_rejected_short') : status.label} />
              </View>
              {view.state === 'rejected' && view.latest?.rejectReason ? (
                <View style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: theme.colors.dangerTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
                  <Glyph name="alert" size={16} color="dangerText" />
                  <Text testID="main-photo-reason" variant="footnote" color="dangerText" style={{ flex: 1 }}>
                    {status.label}
                  </Text>
                </View>
              ) : null}
              <Text variant="footnote" color="text">
                {t(mainPhotoNote(view))}
              </Text>
            </View>
          </Card>

          <Card elevation={1} padding={4}>
            <View style={{ alignItems: 'center', gap: theme.space[3] }}>
              <FaceFrame uri={picked?.uri ?? null} />
              <Text variant="footnote" color="textMuted" align="center">
                {picked ? t('partner.mainphoto_preview_check') : t('partner.mainphoto_guide')}
              </Text>
              {error ? (
                <Text testID="main-photo-error" variant="footnote" color="dangerText" align="center">
                  {error}
                </Text>
              ) : null}
              {!net.online ? (
                <Text testID="main-photo-offline" variant="footnote" color="warningText" align="center">
                  {t('partner.mainphoto_offline')}
                </Text>
              ) : null}
              {picked ? (
                <View style={{ alignSelf: 'stretch', gap: theme.space[2] }}>
                  <Button testID="main-photo-send" label={t('partner.mainphoto_send')} loading={busy} loadingLabel={t('partner.mainphoto_sending')} disabled={!net.online} fullWidth size="lg" onPress={() => void submit()} />
                  <Button testID="main-photo-retake" label={t('partner.mainphoto_retake')} variant="ghost" fullWidth disabled={busy} onPress={() => setPicked(null)} />
                </View>
              ) : (
                <View style={{ alignSelf: 'stretch', gap: theme.space[2] }}>
                  <Button testID="main-photo-camera" label={t('partner.mainphoto_take')} icon="camera" fullWidth size="lg" onPress={() => void pick('camera')} />
                  <Button testID="main-photo-library" label={t('partner.mainphoto_choose')} variant="secondary" fullWidth onPress={() => void pick('library')} />
                </View>
              )}
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}

/** The face-framing guide: a dashed circle (the face goes inside), or the picked photo cropped to it. */
function FaceFrame({ uri }: { uri: string | null }) {
  const theme = useTheme();
  return (
    <View
      testID={uri ? 'main-photo-preview' : 'main-photo-guide'}
      style={{
        width: FRAME,
        height: FRAME,
        borderRadius: FRAME / 2,
        overflow: 'hidden',
        backgroundColor: uri ? theme.colors.surfaceSunken : theme.colors.accentTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri ? <Image source={{ uri }} resizeMode="cover" style={{ position: 'absolute', width: FRAME, height: FRAME }} /> : <Glyph name="face" size={88} color="accentText" />}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 6, left: 6, right: 6, bottom: 6, borderRadius: (FRAME - 12) / 2, borderWidth: 2.5, borderStyle: 'dashed', borderColor: uri ? theme.colors.surface : theme.colors.accent }}
      />
    </View>
  );
}
