import { router } from 'expo-router';
import { View } from 'react-native';
import type { StoreStatusView } from '@driver/contracts';
import { Button, Skeleton, Text, useTheme } from '@driver/ui';
import { LoadFailedLine } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { doorsOf, voiceOf } from './logic';
import { useSetup } from './queries';
import { SetupBar } from './SetupRing';
import { openStep, usePayoutLine } from './nav';
import { SetupSteps, stepTitle } from './SetupSteps';

type SetupLine = NonNullable<StoreStatusView['setup']>;

/**
 * s1 · the board keeps a setup card until the shop is live: «جهّز محلك · 5 من 7», the steps left with
 * their minutes and «كمّل». On a phone it sits in the empty «جديد» lane; on the tablet it is the side
 * card next to «الطلبات تجي هنا». Staff (s5) see only a calm line: setup is the owner's.
 */
export function SetupBoardCard({ storeId, owner, line }: { storeId: string; owner: boolean; line: SetupLine }) {
  const theme = useTheme();
  const t = useT();
  const setup = useSetup(storeId, owner);
  const payout = usePayoutLine(storeId, owner);
  if (!owner) {
    return (
      <View testID="board-setup-staff" style={{ gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: COUNTER.paper, borderWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <MIcon name="store" size={20} color={COUNTER.date} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('merchant.setup.staff_card_title', { percent: line.percent })}
          </Text>
        </View>
        <SetupBar percent={line.percent} />
        <Text variant="footnote" color="textMuted">
          {t('merchant.setup.staff_card_body')}
        </Text>
      </View>
    );
  }
  const v = setup.data;
  const next = v?.progress.next ?? null;
  return (
    <View testID="board-setup" style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
            {t('merchant.setup.title')}
          </Text>
          <Text variant="label" weight={700} tabular style={{ color: COUNTER.newBadge }}>
            {v ? t('merchant.setup.done_of', { done: v.progress.done, total: v.progress.total }) : `${line.percent}%`}
          </Text>
        </View>
        <SetupBar percent={line.percent} />
        {v ? (
          <Text variant="footnote" color="textMuted" tabular>
            {t('merchant.setup.board_left', { minutes: v.progress.minutesLeft })}
          </Text>
        ) : null}
      </View>
      {v ? (
        <SetupSteps view={v} payoutLine={payout} onOpen={openStep} compact />
      ) : setup.isError ? (
        <View style={{ padding: theme.space[4] }}>
          <LoadFailedLine kind="unreachable" title={t('merchant.setup.load_failed')} onRetry={() => void setup.refetch()} testID="board-setup-error" />
        </View>
      ) : (
        <View style={{ padding: theme.space[4] }}>
          <Skeleton height={140} radius={theme.radius.lg} />
        </View>
      )}
      <View style={{ padding: theme.space[4] }}>
        {v && !next ? (
          <Button testID="board-setup-open" label={t('merchant.setup.raise_cta')} size="lg" fullWidth onPress={() => router.push('/setup/open')} />
        ) : (
          <Button testID="board-setup-go" label={next && v ? t('merchant.setup.continue', { step: stepTitle(t, next, voiceOf(doorsOf(v))) }) : t('merchant.setup.continue_plain')} size="lg" fullWidth onPress={() => router.push('/setup')} />
        )}
      </View>
    </View>
  );
}

/** The tablet's big lane while the shop is not live: where orders will come, and how far setup is. */
export function SetupBoardWaiting({ line }: { line: SetupLine }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="board-setup-waiting" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[3], padding: theme.space[8], borderRadius: theme.radius['2xl'], backgroundColor: COUNTER.laneNew }}>
      <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: COUNTER.paper, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name="bag" size={34} color={COUNTER.newBadge} />
      </View>
      <Text align="center" style={[theme.face('display'), { color: COUNTER.date, fontSize: 28, lineHeight: 42 }]}>
        {t('merchant.setup.orders_here')}
      </Text>
      <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 420 }}>
        {line.left === 1 ? t('merchant.setup.orders_here_body_one') : t('merchant.setup.orders_here_body', { count: line.left })}
      </Text>
    </View>
  );
}

/** l3 · the first real order wears a gold ribbon, with a reminder that it works like the practice one. */
export function FirstOrderRibbon() {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="first-order-ribbon" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: COUNTER.busy }}>
      <MIcon name="star" size={18} color={COUNTER.onBusy} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} style={{ color: COUNTER.onBusy }}>
          {t('merchant.setup.first_order')}
        </Text>
        <Text variant="caption" style={{ color: COUNTER.onBusy }}>
          {t('merchant.setup.first_order_hint')}
        </Text>
      </View>
    </View>
  );
}
