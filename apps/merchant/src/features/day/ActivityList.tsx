import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MerchantActivity } from '@driver/contracts';
import { Skeleton, Text, useTheme } from '@driver/ui';
import { Loadable, type QueryState } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Panel } from '@/components/Panel';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { ACTIVITY_COLLAPSED, activityRows, visibleActivity, type ActivityRow } from './logic';

/**
 * «مين سوّى شنو» (owner only, on «يومك» → اليوم): who accepted, rejected, marked ready, added time,
 * handed over, or marked a dish sold out / back on today, newest first. Eight rows, then «شوف الكل».
 * The server refuses staff; the screen only mounts this for the owner.
 */
export function ActivityList({ query }: { query: QueryState<MerchantActivity> }) {
  const t = useT();
  return (
    <Panel title={t('merchant.activity.title')} caption={t('merchant.activity.subtitle')} icon="user" flush testID="activity">
      <Loadable query={query} compact skeleton={<ActivitySkeleton />} failed={t('merchant.activity.failed')} testID="activity-load">
        {(day) => <ActivityRows activity={day} />}
      </Loadable>
    </Panel>
  );
}

function ActivitySkeleton() {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.space[5], gap: theme.space[3] }}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={20} radius={6} />
      ))}
    </View>
  );
}

function ActivityRows({ activity }: { activity: MerchantActivity }) {
  const theme = useTheme();
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const all = activityRows(activity.entries, t);
  if (all.length === 0) {
    return (
      <Text testID="activity-empty" variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
        {t('merchant.activity.empty')}
      </Text>
    );
  }
  const { rows, hidden } = visibleActivity(all, expanded);
  return (
    <View>
      {rows.map((r, i) => (
        <Row key={r.key} row={r} first={i === 0} testID={`activity-row-${i}`} />
      ))}
      {hidden > 0 || (expanded && all.length > ACTIVITY_COLLAPSED) ? (
        <Pressable
          testID="activity-toggle"
          accessibilityRole="button"
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.space[2],
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text variant="label" weight={700} color="accentText">
            {expanded ? t('merchant.activity.show_less') : t('merchant.activity.show_all', { count: all.length })}
          </Text>
          <MIcon name="chevron-down" size={18} color="accentText" style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** «منتظر» bold, what he did, the time at the end; what the system did by itself reads quieter. */
function Row({ row, first, testID }: { row: ActivityRow; first: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={row.line}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[5],
        paddingVertical: theme.space[2],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.colors.border,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.auto ? theme.colors.border : COUNTER.date }} />
      <Text variant="label" style={{ flex: 1 }} numberOfLines={2}>
        <Text variant="label" weight={700} color={row.auto ? 'textMuted' : 'text'}>
          {row.who}
        </Text>
        <Text variant="label" color="textMuted">
          {' · '}
        </Text>
        <Text variant="label" color={row.auto ? 'textMuted' : 'text'}>
          {row.action}
        </Text>
      </Text>
      <Text variant="caption" color="textMuted" tabular>
        {row.time}
      </Text>
    </View>
  );
}
