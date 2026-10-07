import { View } from 'react-native';
import type { MyHouseholdInvite } from '@driver/contracts';
import { Avatar, Button, Card, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useRespondHouseholdInvite } from './queries';

/**
 * SEC-06: an invite to a household, waiting for this person's answer. Who invites and to which
 * household, what they could do there, and what the household would see of them, then «انضم» or
 * «لا شكراً». Nobody joins a household without this yes.
 */
export function HouseholdInviteCard({ invite }: { invite: MyHouseholdInvite }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const respond = useRespondHouseholdInvite();
  const busy = respond.isPending;

  const answer = async (accept: boolean) => {
    try {
      await respond.mutateAsync({ inviteId: invite.id, accept });
      toast.show({ message: accept ? t('household.joined', { household: invite.householdName }) : t('household.invite_declined'), tone: accept ? 'success' : 'neutral' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const what =
    invite.role === 'member'
      ? t('household.my_invite_member')
      : invite.spendingLimitIqd !== null
        ? t('household.my_invite_orderer_limit', { amount: amountParam(invite.spendingLimitIqd) })
        : t('household.my_invite_orderer');

  return (
    <Card testID={`household-invite-${invite.id}`} padding={4} tone="tint">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar icon="family" tone="accent" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">
              {invite.invitedByName
                ? t('household.my_invite_title', { name: invite.invitedByName, household: invite.householdName })
                : t('household.my_invite_title_anon', { household: invite.householdName })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {what}
            </Text>
          </View>
        </View>
        <Text variant="footnote" color="textMuted">
          {t('household.my_invite_privacy')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <View style={{ flex: 1 }}>
            <Button testID={`household-invite-accept-${invite.id}`} label={t('household.my_invite_accept')} fullWidth loading={busy && respond.variables?.accept === true} disabled={busy} onPress={() => void answer(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID={`household-invite-decline-${invite.id}`} label={t('household.my_invite_decline')} variant="secondary" fullWidth loading={busy && respond.variables?.accept === false} disabled={busy} onPress={() => void answer(false)} />
          </View>
        </View>
      </View>
    </Card>
  );
}
