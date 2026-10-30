import type { HouseholdInviteView } from '@driver/contracts';
import { Avatar, Button, ListRow, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useCancelHouseholdInvite } from './queries';

/** SEC-06: someone the payer invited who has not said yes yet: the number's hint, what they'd do, «اسحب الدعوة». */
export function HouseholdInviteRow({ householdId, invite, divider }: { householdId: string; invite: HouseholdInviteView; divider: boolean }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const cancel = useCancelHouseholdInvite();
  const role = invite.role === 'member' ? t('household.role_member_line') : invite.spendingLimitIqd !== null ? [t('household.role_orderer_line'), t('household.limit_per_order', { amount: amountParam(invite.spendingLimitIqd) })].join(' · ') : t('household.role_orderer_line');
  const takeBack = async () => {
    try {
      await cancel.mutateAsync({ householdId, inviteId: invite.id });
      toast.show({ message: t('household.invite_cancelled'), tone: 'neutral' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };
  return (
    <ListRow
      testID={`invite-${invite.id}`}
      leading={<Avatar icon="user" size={40} />}
      title={`⁦${invite.phoneHint}⁩`}
      subtitle={[t('household.state_pending'), role].join(' · ')}
      trailing={<Button testID={`invite-cancel-${invite.id}`} size="sm" variant="ghost" label={t('household.invite_cancel')} loading={cancel.isPending} onPress={() => void takeBack()} />}
      divider={divider}
    />
  );
}
