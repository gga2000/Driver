import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import type { HouseholdMemberView, HouseholdRole, HouseholdTableOrder } from '@driver/contracts';
import { Avatar, Button, Card, EmptyState, ListRow, ModalSheet, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ApprovalCard } from '@/features/account/ApprovalCard';
import { BudgetBar } from '@/features/account/BudgetBar';
import { HouseholdInviteCard } from '@/features/account/HouseholdInviteCard';
import { HouseholdInviteRow } from '@/features/account/HouseholdInviteRow';
import { baghdadDayMonth, monthRows } from '@/features/account/family';
import { useCreateHousehold, useGuardianChildren, useHousehold, useLeaveHousehold, useMe, useMyHouseholdInvites, useMyPlaces } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const ROLE_KEY: Record<HouseholdRole, 'household.role_payer' | 'household.role_orderer' | 'household.role_member'> = {
  payer: 'household.role_payer',
  orderer: 'household.role_orderer',
  member: 'household.role_member',
};

/**
 * «بيتنا» (joy w4, audit S-4): the household as a place. Requests waiting for the payer first, then
 * this month on the household wallet per member (a bullet bar against the monthly budget; the payer
 * sees everyone, a member only themselves), who is in the house and what each may spend, the family
 * table's orders this month, the trusted people (kept on the safety page), خطوط children and the
 * shared places. Payers invite and set limits; everyone else reads. SEC-06: nobody is in a household
 * without saying yes — invites wait here for the invitee (before the «سوّي حساب العائلة» form), the
 * payer sees whom they still wait for (only the number's hint), and anyone but the payer can leave.
 */
export default function Household() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const household = useHousehold();
  const places = useMyPlaces();
  const me = useMe();
  const create = useCreateHousehold();
  const children = useGuardianChildren();
  const invites = useMyHouseholdInvites();
  const leave = useLeaveHousehold();
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const home = household.data;

  if (household.isPending) {
    return (
      <Screen edges={['bottom']} testID="household-loading">
        <Skeleton height={88} />
        <Skeleton height={140} />
        <Skeleton height={180} />
      </Screen>
    );
  }

  if (household.isError && !home) {
    const kind = retryKindFor({ net, error: household.error });
    return (
      <Screen edges={['bottom']} testID="household-error">
        <RetryState
          kind={kind}
          locale={locale}
          art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined}
          {...(kind === 'server' ? { title: t('household.load_error') } : {})}
          onRetry={() => void household.refetch()}
        />
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
    const waiting = invites.data ?? [];
    return (
      <Screen edges={['bottom']} testID="household-create" footer={<Button testID="household-create-submit" label={t('household.create')} size="lg" fullWidth variant={waiting.length > 0 ? 'secondary' : 'primary'} loading={create.isPending} onPress={() => void submit()} />}>
        {invites.isError ? <RetryState size="inline" kind={retryKindFor({ net, error: invites.error })} locale={locale} onRetry={() => void invites.refetch()} /> : null}
        {waiting.length > 0 ? (
          <View style={{ gap: theme.space[3] }} testID="household-my-invites">
            {waiting.map((i) => (
              <HouseholdInviteCard key={i.id} invite={i} />
            ))}
            <SectionHeader title={t('household.or_create')} />
          </View>
        ) : (
          <EmptyState icon="family" title={t('household.create_title')} body={t('household.create_body')} />
        )}
        <TextField label={t('household.name_label')} value={name} onChangeText={setName} placeholder={fallback} maxLength={60} />
      </Screen>
    );
  }

  const payer = home.myRole === 'payer';
  const shared = (places.data ?? []).filter((p) => p.access === 'household' || p.sharedWithHousehold);
  const spend = monthRows(home.members);
  const table = home.month?.tableOrders ?? [];
  const trusted = me.data?.trustedContacts ?? [];
  const label = (m: HouseholdMemberView) => (m.isMe ? t('household.me', { name: m.name ?? m.phoneMasked }) : (m.name ?? `⁦${m.phoneMasked}⁩`));

  const leaveNow = async () => {
    try {
      await leave.mutateAsync({ householdId: home.id });
      setLeaving(false);
      toast.show({ message: t('household.left'), tone: 'success' });
    } catch {
      // Shown in the sheet, which stays open (a toast would sit under it).
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([household.refetch(), places.refetch(), me.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen
      edges={['bottom']}
      testID="household"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
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

      {home.pendingApprovals.length > 0 || payer ? (
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
      ) : null}

      {home.month ? (
        <View style={{ gap: theme.space[3] }} testID="household-month">
          <SectionHeader title={t('household.month_title')} />
          <Card elevation={0} padding={4}>
            <View style={{ gap: theme.space[4] }}>
              {spend.map((m) => (
                <MemberMonth key={m.personId} member={m} label={label(m)} canEdit={payer && m.role !== 'payer'} />
              ))}
              {spend.every((m) => m.monthSpentIqd === 0) ? (
                <Text variant="footnote" color="textMuted">
                  {t('household.month_empty')}
                </Text>
              ) : null}
              {!payer ? (
                <Text variant="caption" color="textMuted">
                  {t('household.month_hint_member')}
                </Text>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('household.members')} />
        <Card elevation={0} padding={0}>
          {home.members.map((m, i) => {
            const editable = payer && m.role !== 'payer';
            const limits = [
              m.spendingLimitIqd !== null ? t('household.limit_per_order', { amount: amountParam(m.spendingLimitIqd) }) : null,
              m.monthlyBudgetIqd !== null ? t('household.limit_per_month', { amount: amountParam(m.monthlyBudgetIqd) }) : null,
            ].filter(Boolean);
            const subtitle =
              m.role === 'payer'
                ? t(ROLE_KEY[m.role])
                : m.role === 'member'
                  ? t('household.role_member_line')
                  : [t('household.role_orderer_line'), limits.length > 0 ? limits.join(' · ') : t('household.no_limit')].join(' · ');
            return (
              <ListRow
                key={m.personId}
                testID={`member-${m.personId}`}
                leading={<Avatar name={m.name ?? '?'} icon={m.name ? undefined : 'user'} size={40} />}
                title={label(m)}
                subtitle={subtitle}
                chevron={editable}
                onPress={editable ? () => router.push({ pathname: '/household/member', params: { personId: m.personId } }) : undefined}
                divider={i < home.members.length - 1}
              />
            );
          })}
        </Card>
      </View>

      {payer && home.invites.length > 0 ? (
        <View style={{ gap: theme.space[3] }} testID="household-invites">
          <SectionHeader title={t('household.invites_title')} />
          <Card elevation={0} padding={0}>
            {home.invites.map((i, n) => (
              <HouseholdInviteRow key={i.id} householdId={home.id} invite={i} divider={n < home.invites.length - 1} />
            ))}
          </Card>
        </View>
      ) : null}

      {home.month ? (
        <View style={{ gap: theme.space[3] }} testID="household-table">
          <SectionHeader title={t('household.table_title')} />
          {table.length === 0 ? (
            <Card elevation={0} padding={4}>
              <Text variant="footnote" color="textMuted">
                {t('household.table_empty')}
              </Text>
            </Card>
          ) : (
            <Card elevation={0} padding={0}>
              {table.map((o, i) => (
                <TableRow key={o.orderId} order={o} mine={o.orderedBy === home.members.find((m) => m.isMe)?.personId} divider={i < table.length - 1} />
              ))}
            </Card>
          )}
        </View>
      ) : null}

      <Card elevation={0} padding={0}>
        <ListRow
          testID="household-trusted"
          leading="shield"
          title={t('household.trusted_title')}
          subtitle={trusted.length > 0 ? t('household.trusted_sub_set', { names: trusted.map((p) => p.name).join('، ') }) : t('household.trusted_sub_empty')}
          onPress={() => router.push('/profile/safety')}
          divider={(children.data ?? []).length > 0}
        />
        {(children.data ?? []).length > 0 ? (
          <ListRow testID="household-children-row" leading="user" title={t('household.children_title')} subtitle={t('household.children_row_sub')} onPress={() => router.push('/household/children')} />
        ) : null}
      </Card>

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

      {!payer ? (
        <Button testID="household-leave" variant="ghost" label={t('household.leave')} fullWidth onPress={() => (leave.reset(), setLeaving(true))} />
      ) : null}

      <ModalSheet
        visible={leaving}
        onClose={() => (leave.isPending ? undefined : setLeaving(false))}
        locked={leave.isPending}
        title={t('household.leave_title', { household: home.name })}
        testID="household-leave-sheet"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="household-leave-confirm" variant="destructive" label={t('household.leave')} loading={leave.isPending} disabled={!net.online} fullWidth onPress={() => void leaveNow()} />
            <Button label={t('action.cancel')} variant="ghost" fullWidth disabled={leave.isPending} onPress={() => setLeaving(false)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('household.leave_body')}
        </Text>
        {leave.isError ? (
          <Text variant="footnote" color="dangerText" testID="household-leave-error">
            {apiErrorMessage(leave.error, t('error.network'), locale)}
          </Text>
        ) : null}
      </ModalSheet>
    </Screen>
  );
}

/** One member's month: name, «46,000 من 100,000 دينار» (or what was spent with no budget), the bar. */
function MemberMonth({ member, label, canEdit }: { member: HouseholdMemberView & { monthSpentIqd: number }; label: string; canEdit: boolean }) {
  const theme = useTheme();
  const t = useT();
  const budget = member.monthlyBudgetIqd;
  const over = budget !== null && member.monthSpentIqd > budget;
  const figure = budget !== null ? t('household.month_spent_of', { spent: amountParam(member.monthSpentIqd), budget: amountParam(budget) }) : t('household.month_spent', { amount: amountParam(member.monthSpentIqd) });
  const body = (
    <View style={{ gap: theme.space[2] }} testID={`month-${member.personId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        <Text variant="footnote" tabular color={over ? 'warningText' : 'text'} weight={over ? 600 : 400}>
          {figure}
        </Text>
      </View>
      <BudgetBar spentIqd={member.monthSpentIqd} budgetIqd={budget} />
      {member.role !== 'payer' && budget === null ? (
        <Text variant="caption" color="textMuted">
          {t('household.month_no_budget')}
        </Text>
      ) : over ? (
        <Text variant="caption" color="warningText">
          {t('household.month_over')}
        </Text>
      ) : null}
    </View>
  );
  if (!canEdit) return body;
  // Payers open the limits editor from the whole block (well over 44 pt tall).
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} · ${figure}`}
      onPress={() => router.push({ pathname: '/household/member', params: { personId: member.personId } })}
      style={({ pressed }) => ({ minHeight: 44, opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/** A family-table order: the kitchen, who ordered and when, how it was paid, waiting or not. */
function TableRow({ order, mine, divider }: { order: HouseholdTableOrder; mine: boolean; divider: boolean }) {
  const t = useT();
  const { day, month } = baghdadDayMonth(order.placedAt);
  const tags = [order.familyTable ? t('household.table_tag_table') : null, order.onHouseholdWallet ? t('household.table_tag_wallet') : null].filter(Boolean);
  return (
    <ListRow
      testID={`table-${order.orderId}`}
      leading="food"
      title={order.merchantName ?? t('household.someone')}
      subtitle={[order.orderedByName ?? t('household.someone'), t('time.date', { day, month }), ...tags].join(' · ')}
      trailing={
        order.status === 'waiting' ? (
          <StatusPill size="sm" tone="warning" label={t('household.table_waiting')} />
        ) : (
          <Text variant="label" tabular>
            {t('unit.iqd', { amount: amountParam(order.totalIqd) })}
          </Text>
        )
      }
      chevron={mine}
      onPress={mine ? () => router.push(`/order/${order.orderId}`) : undefined}
      divider={divider}
    />
  );
}
