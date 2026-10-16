import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { MyStaffInvite } from '@driver/contracts';
import { Button, Card, Skeleton, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Loadable } from '@/components/Loadable';
import { apiErrorMessage } from '@/lib/api';
import { useDates } from '@/lib/dates';
import { useLocale, useT } from '@/lib/i18n';
import { prefs } from '@/lib/prefs';
import { useCounterToast } from '@/lib/toast';
import { roleKey } from './logic';
import { useMyInvites, useRespondInvite } from './queries';

/**
 * PRV-08 (Ali 2026-10-10): a person joins a store only by accepting its invite. The invites waiting
 * for the signed-in person, as cards: «<store> يدعوك تشتغل وياهم» with «اقبل» / «لا شكراً». Accepting
 * opens that store. Renders nothing when there are none; a skeleton while loading, a retry line on
 * failure.
 */
export function MyInvites({ testID }: { testID: string }) {
  const theme = useTheme();
  const t = useT();
  const invites = useMyInvites();
  return (
    <Loadable query={invites} skeleton={<Skeleton height={150} radius={20} />} failed={t('merchant.invites.load_failed')} compact stale={false} testID={`${testID}-invites`}>
      {(list) =>
        list.length === 0 ? null : (
          <View testID={`${testID}-invites`} style={{ gap: theme.space[3] }}>
            <Text variant="label" color="textMuted" accessibilityRole="header">
              {t('merchant.invites.title')}
            </Text>
            {list.map((invite) => (
              <InviteCard key={invite.merchantOrgId} invite={invite} />
            ))}
          </View>
        )
      }
    </Loadable>
  );
}

function InviteCard({ invite }: { invite: MyStaffInvite }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const toast = useCounterToast();
  const respond = useRespondInvite();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const busy = respond.isPending;
  const send = (accept: boolean) => {
    setAnswer(accept);
    respond.mutate(
      { merchantOrgId: invite.merchantOrgId, accept },
      {
        onSuccess: async () => {
          if (!accept) {
            toast.show({ message: t('merchant.invites.declined') });
            return;
          }
          toast.show({ message: t('merchant.invites.accepted', { store: invite.storeName }), tone: 'success' });
          await prefs.setStore(invite.merchantOrgId);
          router.replace('/');
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' }),
      },
    );
  };
  return (
    <Card tone="tint" padding={4} testID={`invite-${invite.merchantOrgId}`}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="store" size={24} color="accentText" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" weight={700}>
              {t('merchant.invites.card', { store: invite.storeName })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('merchant.invites.role', { role: t(roleKey(invite.role)) })} · {t('merchant.invites.until', { date: dates.dayMonth(invite.expiresAt) })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button testID={`invite-accept-${invite.merchantOrgId}`} label={t('merchant.invites.accept')} icon="check" size="md" style={{ flex: 1 }} loading={busy && answer === true} disabled={busy} onPress={() => send(true)} />
          <Button testID={`invite-decline-${invite.merchantOrgId}`} label={t('merchant.invites.decline')} variant="secondary" size="md" style={{ flex: 1 }} loading={busy && answer === false} disabled={busy} onPress={() => send(false)} />
        </View>
      </View>
    </Card>
  );
}
