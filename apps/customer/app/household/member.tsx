import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HOUSEHOLD_RULES } from '@driver/contracts';
import { Avatar, Button, Card, ChipGroup, ModalSheet, RetryState, retryKindFor, Skeleton, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { BudgetBar } from '@/features/account/BudgetBar';
import { parseAmount, presetChoice } from '@/features/account/family';
import { useHousehold, useRemoveHouseholdMember, useSetBudget, useSetLimit } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

type Choice = 'none' | 'other' | number;

/**
 * Payer: a member's limits (joy w4, audit A-04). The per-order limit and the monthly budget, each as
 * presets («10,000» «25,000» «50,000» «بلا حد») or an amount of their own; over either, an order
 * comes to the payer for an OK — never a silent block. Shows what they spent this month. SEC-06: the
 * payer can also take them out of the household (after a confirm).
 */
export default function MemberLimits() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const household = useHousehold();
  const setLimit = useSetLimit();
  const setBudget = useSetBudget();
  const member = household.data?.members.find((m) => m.personId === personId) ?? null;
  const [order, setOrder] = useState<{ choice: Choice; text: string } | null>(null);
  const [month, setMonth] = useState<{ choice: Choice; text: string } | null>(null);
  const remove = useRemoveHouseholdMember();
  const [removing, setRemoving] = useState(false);

  // Start from what is stored, once it arrives.
  useEffect(() => {
    if (!member) return;
    setOrder((v) => v ?? { choice: presetChoice(member.spendingLimitIqd, HOUSEHOLD_RULES.limitPresetsIqd), text: member.spendingLimitIqd !== null ? member.spendingLimitIqd.toLocaleString('en-US') : '' });
    setMonth((v) => v ?? { choice: presetChoice(member.monthlyBudgetIqd, HOUSEHOLD_RULES.budgetPresetsIqd), text: member.monthlyBudgetIqd !== null ? member.monthlyBudgetIqd.toLocaleString('en-US') : '' });
  }, [member]);

  if (household.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={56} />
        <Skeleton height={160} />
      </Screen>
    );
  }
  if (!member || !household.data) {
    return (
      <Screen edges={['bottom']} testID="member-error">
        <RetryState kind={retryKindFor({ net, error: household.error })} locale={locale} {...(household.isError ? {} : { title: t('household.load_error') })} onRetry={() => void household.refetch()} />
      </Screen>
    );
  }

  const valueOf = (s: { choice: Choice; text: string } | null): number | null | undefined => {
    if (!s) return undefined;
    if (s.choice === 'none') return null;
    if (s.choice === 'other') return parseAmount(s.text) ?? undefined;
    return s.choice;
  };
  const orderValue = valueOf(order);
  const monthValue = valueOf(month);
  const ready = orderValue !== undefined && monthValue !== undefined;
  const busy = setLimit.isPending || setBudget.isPending;
  const homeId = household.data.id;

  const save = async () => {
    if (orderValue === undefined || monthValue === undefined) return;
    try {
      if (orderValue !== member.spendingLimitIqd) await setLimit.mutateAsync({ householdId: homeId, personId: member.personId, spendingLimitIqd: orderValue });
      if (monthValue !== member.monthlyBudgetIqd) await setBudget.mutateAsync({ householdId: homeId, personId: member.personId, monthlyBudgetIqd: monthValue });
      toast.show({ message: t('household.limits_saved'), tone: 'success' });
      router.back();
    } catch {
      // Shown in the sheet, which stays open (a toast would sit under it).
    }
  };

  const shownName = member.name ?? `⁦${member.phoneMasked}⁩`;
  const removeNow = async () => {
    try {
      await remove.mutateAsync({ householdId: homeId, personId: member.personId });
      setRemoving(false);
      toast.show({ message: t('household.removed'), tone: 'success' });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen edges={['bottom']} testID="member-limits" footer={<Button testID="member-save" label={t('action.save')} size="lg" fullWidth disabled={!ready} loading={busy} onPress={() => void save()} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={member.name ?? '?'} icon={member.name ? undefined : 'user'} size={48} />
        <Text variant="title" style={{ flexShrink: 1 }}>
          {shownName}
        </Text>
      </View>

      {member.monthSpentIqd !== null ? (
        <Card elevation={0} padding={4} testID="member-month">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong" tabular>
              {t('household.member_month', { amount: amountParam(member.monthSpentIqd) })}
            </Text>
            <BudgetBar spentIqd={member.monthSpentIqd} budgetIqd={member.monthlyBudgetIqd} />
          </View>
        </Card>
      ) : null}

      <LimitPicker
        testID="limit-order"
        title={t('household.limit_order_title')}
        hint={t('household.limit_order_hint')}
        presets={HOUSEHOLD_RULES.limitPresetsIqd}
        state={order}
        onChange={setOrder}
      />
      <LimitPicker
        testID="limit-month"
        title={t('household.limit_month_title')}
        hint={t('household.limit_month_hint')}
        presets={HOUSEHOLD_RULES.budgetPresetsIqd}
        state={month}
        onChange={setMonth}
      />

      <Button testID="member-remove" variant="ghost" label={t('household.remove')} fullWidth onPress={() => (remove.reset(), setRemoving(true))} />
      <ModalSheet
        visible={removing}
        onClose={() => (remove.isPending ? undefined : setRemoving(false))}
        locked={remove.isPending}
        title={t('household.remove_title', { name: shownName })}
        testID="member-remove-sheet"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="member-remove-confirm" variant="destructive" label={t('household.remove')} loading={remove.isPending} disabled={!net.online} fullWidth onPress={() => void removeNow()} />
            <Button label={t('action.cancel')} variant="ghost" fullWidth disabled={remove.isPending} onPress={() => setRemoving(false)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('household.remove_body')}
        </Text>
        {remove.isError ? (
          <Text variant="footnote" color="dangerText" testID="member-remove-error">
            {apiErrorMessage(remove.error, t('error.network'), locale)}
          </Text>
        ) : null}
      </ModalSheet>
    </Screen>
  );
}

function LimitPicker({
  title,
  hint,
  presets,
  state,
  onChange,
  testID,
}: {
  title: string;
  hint: string;
  presets: readonly number[];
  state: { choice: Choice; text: string } | null;
  onChange: (next: { choice: Choice; text: string }) => void;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  const current = state ?? { choice: 'none' as Choice, text: '' };
  const id = (c: Choice) => (typeof c === 'number' ? String(c) : c);
  return (
    <View style={{ gap: theme.space[3] }} testID={testID}>
      <Text variant="title">{title}</Text>
      <ChipGroup
        mode="single"
        required
        value={[id(current.choice)]}
        onChange={(next) => {
          const v = next[0];
          if (!v) return;
          const choice: Choice = v === 'none' || v === 'other' ? v : Number(v);
          onChange({ choice, text: current.text });
        }}
        items={[
          ...presets.map((p) => ({ id: String(p), label: t('unit.iqd', { amount: amountParam(p) }) })),
          { id: 'none', label: t('household.no_limit') },
          { id: 'other', label: t('household.limit_other') },
        ]}
      />
      {current.choice === 'other' ? (
        <TextField testID={`${testID}-amount`} label={t('household.limit_amount_label')} value={current.text} onChangeText={(text) => onChange({ choice: 'other', text })} placeholder="75,000" keyboardType="number-pad" />
      ) : null}
      <Text variant="footnote" color="textMuted">
        {hint}
      </Text>
    </View>
  );
}
