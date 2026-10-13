import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SHOPPING_RULES } from '@driver/contracts';
import type { BakeryOwnerView, ShopState } from '@driver/contracts/shopping';
import { formatClock } from '@driver/i18n';
import { Button, Skeleton, Text, useTheme, withAlpha } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { Panel } from '@/components/Panel';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { useMarketActions, useOven } from './queries';

/** "06:30" (Baghdad wall clock) → "6:30 ص" on the one clock the app uses. */
function wall(hm: string, locale: 'ar-IQ' | 'en'): string {
  const [h, m] = hm.split(':').map(Number);
  return formatClock(Date.UTC(2026, 0, 1, (h ?? 0) - 3, m ?? 0), { locale });
}

const BUTTONS: { state: ShopState; icon: MIconName; title: TKey; hint: TKey }[] = [
  { state: 'open', icon: 'home', title: 'merchant.market.oven.open', hint: 'merchant.market.oven.open_hint' },
  { state: 'paused', icon: 'pause', title: 'merchant.market.oven.pause', hint: 'merchant.market.oven.pause_hint' },
  { state: 'closed', icon: 'lock', title: 'merchant.market.oven.close', hint: 'merchant.market.oven.close_hint' },
];

/**
 * «الفرن» (Ali 2026-10-11: bakeries bake all day, no batches): the baker only opens, pauses for a
 * quarter / half / whole hour (it reopens by itself), or closes. Orders still come on the board.
 */
export function OvenScreen() {
  const t = useT();
  const { store } = useCurrentStore();
  const oven = useOven(store?.orgId ?? null);
  return (
    <Page title={t('merchant.market.oven.title')} back maxWidth={640} testID="market-oven">
      <Loadable query={oven} failed={t('merchant.market.oven.load_failed')} testID="market-oven-load" skeleton={<Skeleton height={240} />}>
        {(view) => <Oven view={view} />}
      </Loadable>
    </Page>
  );
}

function Oven({ view }: { view: BakeryOwnerView }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const toast = useCounterToast();
  const { oven } = useMarketActions();
  const set = (state: ShopState, pauseMin?: number) =>
    oven.mutate(
      { merchantOrgId: view.orgId, state, ...(pauseMin ? { pauseMin } : {}) },
      { onError: (err) => toast.show({ message: apiErrorMessage(err, t('merchant.market.oven.failed'), locale), tone: 'danger' }) },
    );
  const live =
    view.state === 'open'
      ? t('merchant.market.oven.live_open')
      : view.state === 'paused'
        ? t('merchant.market.oven.live_paused', { time: view.resumesAt ? wall(view.resumesAt, locale) : '' })
        : t('merchant.market.oven.live_closed');
  const dot = view.state === 'open' ? COUNTER.onDateReady : view.state === 'paused' ? COUNTER.busy : COUNTER.onDateLate;

  return (
    <View style={{ gap: theme.space[4] }}>
      <Text variant="label" color="textMuted">
        {view.name}
      </Text>
      <View testID="oven-card" style={{ backgroundColor: COUNTER.date, borderRadius: 28, padding: theme.space[4], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} accessibilityLiveRegion="polite">
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dot }} />
          <Text variant="label" weight={700} style={{ color: COUNTER.onDate, flex: 1 }}>
            {live}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {BUTTONS.map((b) => {
            const on = view.state === b.state;
            return (
              <Pressable
                key={b.state}
                testID={`oven-${b.state}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on, busy: oven.isPending }}
                disabled={oven.isPending || (on && b.state !== 'paused')}
                // «وقّف شوية» alone starts the shortest pause; the row below picks a longer one.
                onPress={() => set(b.state, b.state === 'paused' ? SHOPPING_RULES.pauseMinutes[0] : undefined)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 118,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingHorizontal: 4,
                  backgroundColor: on ? COUNTER.busy : withAlpha(COUNTER.onDate, 0.08),
                  borderWidth: on ? 0 : 1,
                  borderColor: COUNTER.dateEdge,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <MIcon name={b.icon} size={26} color={on ? 'text' : 'surface'} />
                <Text variant="title" weight={700} align="center" style={{ color: on ? COUNTER.onBusy : COUNTER.onDate }}>
                  {t(b.title)}
                </Text>
                <Text variant="caption" align="center" style={{ color: on ? COUNTER.onBusy : COUNTER.onDateMuted }}>
                  {t(b.hint)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Panel title={t('merchant.market.oven.pause_title')}>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {SHOPPING_RULES.pauseMinutes.map((m) => (
            <Button key={m} testID={`oven-pause-${m}`} label={t(`merchant.market.oven.pause_${m}` as TKey)} size="sm" variant="secondary" disabled={oven.isPending} onPress={() => set('paused', m)} style={{ flex: 1 }} />
          ))}
        </View>
        <Text variant="footnote" color="textMuted">
          {t('merchant.market.oven.pause_note')}
        </Text>
      </Panel>

      <Panel title={t('merchant.market.oven.daily_title')} icon="clock">
        {view.dailyToday.map((d) => (
          <View key={d.time} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
            <Text variant="body" tabular>
              {wall(d.time, locale)}
            </Text>
            <Text variant="label" weight={700} tabular color={d.pieces ? 'text' : 'textMuted'}>
              {d.pieces ? t('merchant.market.oven.daily_row', { count: d.pieces }) : t('merchant.market.oven.daily_none')}
            </Text>
          </View>
        ))}
      </Panel>

      <Button testID="oven-orders" label={t('merchant.market.oven.orders')} icon="receipt" variant="secondary" onPress={() => router.navigate('/')} />
    </View>
  );
}
