import { useState } from 'react';
import { View } from 'react-native';
import type { StaffMember } from '@driver/contracts';
import { Avatar, Button, Skeleton, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { OwnerOnly } from '@/components/OwnerOnly';
import { Page } from '@/components/Page';
import { Panel, PanelRow, Tag } from '@/components/Panel';
import { roleKey, splitStaff } from '@/features/staff/logic';
import { useStaff } from '@/features/staff/queries';
import { InviteSheet, MemberSheet } from '@/features/staff/StaffSheets';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

/** الموظفين (owners only): the team with roles, invites waiting for a first sign-in, add by phone. */
export default function StaffScreen() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const staff = useStaff(store?.orgId ?? null, canSeeMoney);
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (store && !canSeeMoney) return <OwnerOnly title={t('merchant.more.staff')} back testID="staff" />;

  const list = staff.data ?? [];
  const { team, pending } = splitStaff(list);
  const member = list.find((s) => s.personId === open) ?? null;
  const add = <Button testID="staff-invite" label={t('merchant.staff.invite')} icon="plus" onPress={() => setInviting(true)} size={wide ? 'md' : 'lg'} fullWidth={!wide} />;

  return (
    <Page title={t('merchant.more.staff')} subtitle={staff.data ? t('merchant.staff.subtitle', { count: list.length }) : store?.name} back testID="staff" aside={wide ? add : undefined}>
      {!staff.data ? (
        <Skeleton height={260} radius={20} />
      ) : (
        <>
          <Panel title={t('merchant.staff.team_title')} icon="people" flush testID="staff-team">
            {team.map((s, i) => (
              <Row key={s.personId} member={s} first={i === 0} onPress={() => setOpen(s.personId)} />
            ))}
            {team.length === 1 ? (
              <View style={{ flexDirection: 'row', gap: theme.space[2], paddingHorizontal: theme.space[5], paddingTop: theme.space[2] }}>
                <MIcon name="people" size={18} color="textMuted" />
                <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                  {t('merchant.staff.empty')}
                </Text>
              </View>
            ) : null}
          </Panel>
          {pending.length > 0 ? (
            <Panel title={t('merchant.staff.pending_title')} caption={t('merchant.staff.pending_hint')} icon="hourglass" flush testID="staff-pending">
              {pending.map((s, i) => (
                <Row key={s.personId} member={s} first={i === 0} onPress={() => setOpen(s.personId)} />
              ))}
            </Panel>
          ) : null}
          {wide ? null : add}
        </>
      )}
      {store ? <InviteSheet merchantOrgId={store.orgId} visible={inviting} onClose={() => setInviting(false)} /> : null}
      {store ? <MemberSheet merchantOrgId={store.orgId} member={member} all={list} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}

function Row({ member: s, first, onPress }: { member: StaffMember; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const owner = s.role === 'merchant_owner';
  return (
    <PanelRow first={first} onPress={onPress} testID={`staff-${s.personId}`}>
      <Avatar name={s.name ?? undefined} icon={s.name ? undefined : 'user'} size={44} tone={owner ? 'accent' : s.pending ? 'warning' : 'info'} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" numberOfLines={1} color={s.name ? 'text' : 'textMuted'} style={{ flexShrink: 1 }}>
            {s.name ?? t('merchant.staff.no_name')}
          </Text>
          {s.you ? <Tag label={t('merchant.staff.you')} tone="neutral" /> : null}
        </View>
        {s.phoneMasked ? (
          <Text variant="caption" color="textMuted" tabular>
            {`⁦${s.phoneMasked}⁩`}
          </Text>
        ) : null}
      </View>
      {s.pending ? <Tag label={t('merchant.staff.pending')} tone="warning" icon="clock" /> : null}
      <Tag label={t(roleKey(s.role))} tone={owner ? 'accent' : 'info'} icon={owner ? 'shield' : undefined} />
      <MIcon name="chevron-forward" size={18} color="textMuted" />
    </PanelRow>
  );
}
