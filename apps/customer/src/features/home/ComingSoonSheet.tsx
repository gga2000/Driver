import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LaunchService } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Icon, IconButton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { useDeliverTo } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import { requireSignIn } from '@/lib/guest';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

const COPY: Record<LaunchService, { icon: IconName; title: MessageKey; body: MessageKey }> = {
  grocery: { icon: 'cart', title: 'soon.grocery_title', body: 'soon.grocery_body' },
  khat: { icon: 'clock', title: 'soon.khat_title', body: 'soon.khat_body' },
  parcel: { icon: 'parcel', title: 'soon.parcel_title', body: 'soon.parcel_body' },
};

/** The services this person asked to hear about (`notify.myLaunchInterests`). */
export function useLaunchInterests() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.notify.myLaunchInterests.queryOptions(), enabled: signedIn, staleTime: 5 * 60_000 });
}

/**
 * A coming-soon tile's sheet (audit C-03): what the service is, that it starts soon, and "خبرني لمن
 * تنفتح", which records the interest (`notify.launchInterest`, with the deliver-to zone so the Console
 * sees demand by area). A guest adds their number first and comes back home.
 */
export function ComingSoonSheet({ service, onClose }: { service: LaunchService | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const { place } = useDeliverTo();
  const mine = useLaunchInterests();
  const register = useMutation(
    api.notify.launchInterest.mutationOptions({
      onSuccess: (data) => qc.setQueryData(api.notify.myLaunchInterests.queryKey(), data),
      onError: () => toast.show({ message: t('soon.notify_failed'), tone: 'danger' }),
    }),
  );
  if (!service) return null;
  const c = COPY[service];
  const done = mine.data?.services.includes(service) ?? false;

  const notifyMe = () => {
    if (!signedIn) {
      onClose();
      void requireSignIn('/');
      return;
    }
    register.mutate({ service, ...(place ? { zoneKey: place.zoneId } : {}) });
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
        <View
          testID={`soon-sheet-${service}`}
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: 'center',
            backgroundColor: theme.colors.surface,
            borderTopStartRadius: theme.radius['2xl'],
            borderTopEndRadius: theme.radius['2xl'],
            paddingHorizontal: theme.space[5],
            paddingTop: theme.space[3],
            paddingBottom: theme.space[5] + insets.bottom,
            gap: theme.space[5],
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
            <View style={{ width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={c.icon} size={28} color="accentText" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1, gap: theme.space[1] }}>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken }}>
                <Text variant="caption" weight={600} color="textMuted">
                  {t('soon.badge')}
                </Text>
              </View>
              <Text variant="title" accessibilityRole="header">
                {t(c.title)}
              </Text>
            </View>
            <IconButton icon="x" variant="tonal" size={44} accessibilityLabel={t('action.close')} onPress={onClose} testID="soon-close" />
          </View>
          <Text variant="body" color="textMuted" style={{ lineHeight: 26 }}>
            {t(c.body)}
          </Text>
          {done ? (
            <View testID="soon-done" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
              <Icon name="check" size={22} color="successText" strokeWidth={2.4} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" color="successText">
                  {t('soon.notify_done')}
                </Text>
                <Text variant="footnote" color="successText">
                  {t('soon.notify_done_body')}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ gap: theme.space[3] }}>
              <Text variant="label" weight={600}>
                {t('soon.when')}
              </Text>
              <Button
                testID="soon-notify"
                size="lg"
                fullWidth
                icon={signedIn ? 'bell' : 'phone'}
                label={signedIn ? t('soon.notify_me') : t('soon.notify_guest')}
                loading={register.isPending}
                onPress={notifyMe}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
