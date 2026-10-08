import { router, Stack } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import type { OpsCashHolder, OpsTask } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, IconButton, RetryState, retryKindFor, Skeleton, StatusPill, Text, useLoadTimeout, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/features/fleet/FleetParts';
import { clockTime } from '@/features/account/logic';
import { DUE_KEY, dueOf, TASK_KIND_KEY } from '@/features/ops/logic';
import { ActionTile, TASK_ICON } from '@/features/ops/OpsParts';
import { useCashHolders, useCompleteTask, useMenuPhotoRequests, useOpsTasks } from '@/features/ops/queries';
import { useMe } from '@/features/work/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * وضع العمليات — field staff's home: what they do in the street (cash from couriers, landmark
 * photos, shop sign-ups, restaurants' menu shoots, wallet top-ups) and the day's tasks: couriers to collect cash from (computed
 * live from the ledger) and stored follow-ups they can tick off.
 */
export default function OpsHome() {
  const theme = useTheme();
  const t = useT();
  const me = useMe().data;
  const tasks = useOpsTasks();
  const holders = useCashHolders();
  const menuRequests = useMenuPhotoRequests();
  const locale = useLocale();
  const net = useNetwork();
  const [slow, restartSlow] = useLoadTimeout(tasks.data === undefined && !tasks.isError);
  const retry = () => {
    restartSlow();
    void tasks.refetch();
    void holders.refetch();
  };
  // f5: with no network the list on screen is the last one we had; say from when.
  const stale = !net.online && tasks.data !== undefined && tasks.dataUpdatedAt > 0;
  const inField = (holders.data ?? []).reduce((s, h) => s + h.heldIqd, 0);
  const firstName = me?.name?.split(' ')[0];

  return (
    <Screen
      edges={['bottom']}
      testID="ops-home"
      refreshControl={
        <RefreshControl
          refreshing={tasks.isRefetching}
          onRefresh={() => {
            void tasks.refetch();
            void holders.refetch();
          }}
        />
      }
    >
      <Stack.Screen options={{ title: t('partner.hub_ops') }} />
      <View style={{ gap: 2 }}>
        <Text variant="heading" accessibilityRole="header">
          {firstName ? t('partner.ops_hello', { name: firstName }) : t('partner.hub_ops')}
        </Text>
        <Text variant="body" color="textMuted">
          {t('partner.ops_intro')}
        </Text>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <ActionTile
          testID="ops-go-cash"
          dark
          icon="wallet"
          title={t('partner.ops_action_cash')}
          sub={t('partner.ops_action_cash_sub')}
          meta={inField > 0 ? t('partner.ops_cash_in_field', { amount: amountParam(inField) }) : undefined}
          onPress={() => router.push('/ops/cash')}
        />
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <ActionTile testID="ops-go-landmark" glyph="camera" title={t('partner.ops_action_landmark')} sub={t('partner.ops_action_landmark_sub')} onPress={() => router.push('/ops/landmark')} style={{ flex: 1 }} />
          <ActionTile testID="ops-go-onboard" icon="bag" title={t('partner.ops_action_merchant')} sub={t('partner.ops_action_merchant_sub')} onPress={() => router.push('/ops/onboard')} style={{ flex: 1 }} />
        </View>
        <ActionTile
          testID="ops-go-menu-photos"
          glyph="camera"
          title={t('partner.ops_action_menu_photos')}
          sub={t('partner.ops_action_menu_photos_sub')}
          meta={menuRequests.data && menuRequests.data.length > 0 ? t('partner.ops_mp_waiting', { n: menuRequests.data.length }) : undefined}
          onPress={() => router.push('/ops/menu-photos')}
        />
        <ActionTile testID="ops-go-topup" icon="plus" title={t('partner.ops_action_topup')} sub={t('partner.ops_action_topup_sub')} onPress={() => router.push('/ops/topup')} />
      </View>

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={tasks.data ? `${t('partner.ops_tasks_title')} · ${tasks.data.length}` : t('partner.ops_tasks_title')} />
        {stale ? (
          <View testID="ops-stale" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[1] }}>
            <Icon name="wifi-off" size={16} color="warningText" />
            <Text variant="footnote" color="warningText" tabular style={{ flex: 1 }}>
              {t('partner.f5_ops_stale', { time: clockTime(new Date(tasks.dataUpdatedAt)) })}
            </Text>
          </View>
        ) : null}
        {!tasks.data && (tasks.isError || slow) ? (
          <Card elevation={0}>
            {(() => {
              const kind = retryKindFor({ net, error: tasks.error, slow });
              return <RetryState testID="ops-retry" kind={kind} locale={locale} title={kind === 'server' ? t('partner.f5_ops_failed') : undefined} onRetry={retry} />;
            })()}
          </Card>
        ) : !tasks.data ? (
          <Skeleton lines={3} />
        ) : tasks.data.length === 0 ? (
          <Card elevation={0} testID="ops-tasks-empty">
            <EmptyState icon="check" title={t('partner.ops_tasks_empty')} body={t('partner.ops_tasks_empty_body')} />
          </Card>
        ) : (
          <Card elevation={1} padding={0} testID="ops-tasks">
            {tasks.data.map((task, i) => (
              <TaskRow key={task.taskId} task={task} holder={holders.data?.find((h) => h.courierId === task.refId)} divider={i < tasks.data.length - 1} />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

function TaskRow({ task, holder, divider }: { task: OpsTask; holder: OpsCashHolder | undefined; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const complete = useCompleteTask();
  const cash = task.kind === 'cash_collection';
  const due = dueOf(task.dueAt, new Date());
  const over = cash && holder?.overCap;
  const title = cash ? t('partner.ops_task_cash', { name: holder?.name ?? t('partner.ops_task_courier') }) : task.title_ar;

  const done = async () => {
    try {
      await complete.mutateAsync({ taskId: task.taskId });
      toast.show({ tone: 'success', message: t('partner.ops_task_completed') });
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <View
      testID={`ops-task-${task.taskId}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: over ? theme.colors.dangerTint : cash ? theme.colors.accentTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={TASK_ICON[task.kind]} size={20} color={over ? 'dangerText' : cash ? 'accentText' : 'text'} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600} numberOfLines={2}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          {cash && task.amountIqd !== null ? (
            <Text variant="caption" color={over ? 'dangerText' : 'textMuted'} tabular>
              {t('partner.ops_task_cash_amount', { amount: amountParam(task.amountIqd) })}
            </Text>
          ) : (
            <Text variant="caption" color="textMuted">
              {t(TASK_KIND_KEY[task.kind])}
            </Text>
          )}
          {over ? <StatusPill size="sm" tone="danger" label={t('partner.ops_task_over_cap')} /> : null}
          {due ? <StatusPill size="sm" tone={due === 'overdue' ? 'danger' : 'neutral'} icon="clock" label={t(DUE_KEY[due])} /> : null}
        </View>
      </View>
      {cash ? (
        <Button
          testID={`ops-task-collect-${task.refId}`}
          label={t('partner.ops_task_collect')}
          size="sm"
          variant="secondary"
          onPress={() => router.push({ pathname: '/ops/cash', params: { courierId: task.refId ?? '' } })}
        />
      ) : (
        <IconButton testID={`ops-task-done-${task.taskId}`} icon="check" variant="outline" accessibilityLabel={t('partner.ops_task_done')} onPress={() => void done()} disabled={complete.isPending} />
      )}
    </View>
  );
}
