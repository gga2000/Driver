import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Icon, ModalSheet, Text, useTheme, useToast, type IconName } from '@driver/ui';
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
 * A coming-soon tile's sheet (audit C-03), on the shared `ModalSheet`: what the service is, that it starts soon, and "خبرني لمن
 * تنفتح", which records the interest (`notify.launchInterest`, with the deliver-to zone so the Console
 * sees demand by area). A guest adds their number first and comes back home.
 */
export function ComingSoonSheet({ service, onClose }: { service: LaunchService | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
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
    <ModalSheet
      visible
      onClose={onClose}
      title={t(c.title)}
      subtitle={t('soon.badge')}
      leading={
        <View style={{ width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={c.icon} size={28} color="accentText" strokeWidth={1.8} />
        </View>
      }
      layout="sheet"
      sheetMaxWidth={MAX_CONTENT_WIDTH}
      closeLabel={t('action.close')}
      testID={`soon-sheet-${service}`}
    >
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
    </ModalSheet>
  );
}
