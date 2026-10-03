import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { HouseholdRole } from '@driver/contracts';
import { Avatar, Button, Card, EmptyState, ListRow, Skeleton, StatusPill, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ApprovalCard } from '@/features/account/ApprovalCard';
import { useCreateHousehold, useHousehold, useMe, useMyPlaces } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const ROLE_KEY: Record<HouseholdRole, 'household.role_payer' | 'household.role_orderer' | 'household.role_member'> = {
  payer: 'household.role_payer',
  orderer: 'household.role_orderer',
  member: 'household.role_member',
};

/**
 * العائلة (domain §12, customer spec §9): approval requests first, then members with their limits,
 * then the places shared with the household. Payers invite and set limits; others read.
 */
export default function Household() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const household = useHousehold();
  const places = useMyPlaces();
  const me = useMe();
  const create = useCreateHousehold();
  const [name, setName] = useState('');
  const home = household.data;

  if (household.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={120} />
      </Screen>
    );
  }

  if (!home) {
    const fallback = me.data?.name ? t('household.default_name', { name: me.data.name }) : t('household.title');
    const submit = async () => {
      try {
        await create.mutateAsync({ name: name.trim() || fallback });
      } catch (err) {
        toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
      }
    };
    return (
      <Screen edges={['bottom']} testID="household-create" footer={<Button testID="household-create-submit" label={t('household.create')} size="lg" fullWidth loading={create.isPending} onPress={() => void submit()} />}>
        <EmptyState icon="user" title={t('household.create_title')} body={t('household.create_body')} />
        <TextField label={t('household.name_label')} value={name} onChangeText={setName} placeholder={fallback} maxLength={60} />
      </Screen>
    );
  }

  const payer = home.myRole === 'payer';
  const shared = (places.data ?? []).filter((p) => p.access === 'household' || p.sharedWithHousehold);

  return (
    <Screen
      edges={['bottom']}
      testID="household"
      footer={payer ? <Button testID="household-invite" icon="plus" variant="secondary" label={t('household.invite')} fullWidth onPress={() => router.push('/household/invite')} /> : undefined}
    >
      <Card padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text variant="title">{home.name}</Text>
            <Text variant="footnote" color="textMuted">
              {t('account.household_members', { n: home.members.length })}
            </Text>
          </View>
          <StatusPill size="sm" tone="accent" label={t(ROLE_KEY[home.myRole])} />
        </View>
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={payer ? t('household.requests_payer') : t('household.requests_mine')} />
        {home.pendingApprovals.length === 0 ? (
          <Text variant="footnote" color="textMuted">
            {t('household.no_requests')}
          </Text>
        ) : (
          home.pendingApprovals.map((a) => <ApprovalCard key={a.id} approval={a} />)
        )}
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('household.members')} />
        <Card elevation={0} padding={0}>
          {home.members.map((m, i) => {
            const label = m.isMe ? t('household.me', { name: m.name ?? m.phoneMasked }) : (m.name ?? `⁦${m.phoneMasked}⁩`);
            const limit = m.spendingLimitIqd === null ? t('household.no_limit') : t('household.limit_short', { amount: amountParam(m.spendingLimitIqd) });
            const editable = payer && m.role !== 'payer';
            return (
              <ListRow
                key={m.personId}
                testID={`member-${m.personId}`}
                leading={<Avatar name={m.name ?? '?'} icon={m.name ? undefined : 'user'} size={40} />}
                title={label}
                subtitle={m.role === 'payer' ? t(ROLE_KEY[m.role]) : `${t(ROLE_KEY[m.role])} · ${limit}`}
                chevron={editable}
                onPress={editable ? () => router.push({ pathname: '/household/member', params: { personId: m.personId } }) : undefined}
                divider={i < home.members.length - 1}
              />
            );
          })}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('household.shared_places')} />
        {shared.length === 0 ? (
          <Text variant="footnote" color="textMuted">
            {t('household.shared_places_empty')}
          </Text>
        ) : (
          <Card elevation={0} padding={0}>
            {shared.map((p, i) => (
              <ListRow
                key={p.id}
                leading={p.label === 'home' ? 'home' : p.label === 'work' ? 'bag' : 'map-pin'}
                title={p.name}
                subtitle={locale === 'en' ? p.zoneName_en : p.zoneName_ar}
                trailing={p.access === 'household' ? <StatusPill size="sm" tone="info" label={t('place.from_household')} /> : undefined}
                onPress={() => router.push({ pathname: '/places/edit', params: { id: p.id } })}
                divider={i < shared.length - 1}
              />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}
