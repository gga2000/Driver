import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VehicleClass } from '@driver/contracts';
import { color as palette, partnerDash } from '@driver/design-tokens';
import { Avatar, Icon, Text, usePulse, useTheme } from '@driver/ui';
import { DASH_MAX_WIDTH } from '@/features/home/DashParts';
import type { DashState } from '@/features/home/logic';
import { jobsKey, VEHICLE_ICON, VEHICLE_KEY } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The live home's top, floating over the map: «هلا حيدر · دراجة» and today's money on one card.
 * Waiting: cream. Working: saffron with a breathing dot and «شغّال · ندورلك طلب». No internet: ink.
 * Under it, the «يومي» / «المدينة» switch.
 */
export function LiveTop({
  state,
  name,
  vehicle,
  earningsIqd,
  jobs,
  sinceClock,
  cutTitle,
  cutBody,
  day,
  onDay,
  note,
  onLayout,
}: {
  state: DashState;
  name: string | null;
  vehicle: VehicleClass;
  earningsIqd: number;
  jobs: number;
  sinceClock: string | null;
  cutTitle: string;
  cutBody: string;
  /** «يومي» is open. */
  day: boolean;
  onDay: () => void;
  /** A quiet line under the card («اشتغل وتشوف…», «بعدك ما وصّلت…»). */
  note: string | null;
  onLayout?: (h: number) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const dash = partnerDash[theme.scheme === 'dark' ? 'ember' : 'sun'];
  const working = state === 'working';
  const cut = state === 'cut';
  const pulse = usePulse(working);
  const bg = cut ? dash.offline : working ? dash.working[1] : theme.colors.surface;
  const ink = cut ? dash.onOffline : working ? dash.onWorking : theme.colors.text;
  const muted = cut ? dash.onOfflineMuted : working ? dash.onWorkingMuted : theme.colors.textMuted;
  return (
    <View
      testID="dash-top"
      pointerEvents="box-none"
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
      style={{ position: 'absolute', top: 0, start: 0, end: 0, paddingTop: insets.top + theme.space[2], paddingHorizontal: theme.space[3], gap: theme.space[2] }}
    >
      <View style={{ width: '100%', maxWidth: DASH_MAX_WIDTH, alignSelf: 'center', gap: theme.space[2] }} pointerEvents="box-none">
        <View style={{ backgroundColor: bg, borderRadius: 24, paddingVertical: theme.space[3], paddingHorizontal: theme.space[4], gap: theme.space[2], borderWidth: working || cut ? 0 : 1.5, borderColor: theme.colors.border, ...shadow }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Avatar name={name ?? undefined} {...(name ? {} : { icon: 'user' as const })} size={40} tone="accent" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" weight={700} color={ink} numberOfLines={1} testID="dash-hello">
                {name ? t('partner.dash_hello', { name }) : t('partner.dash_hello_noname')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="vehicle-chip">
                <Icon name={VEHICLE_ICON[vehicle]} size={14} color={muted} strokeWidth={2} />
                <Text variant="caption" weight={600} color={muted} numberOfLines={1}>
                  {t(VEHICLE_KEY[vehicle])}
                  {jobs > 0 ? ` · ${t(jobsKey(jobs), { n: jobs })}` : ''}
                </Text>
              </View>
            </View>
            <View testID="today-pill" accessible accessibilityLabel={t('partner.dash_today') + ' ' + amountParam(earningsIqd) + ' ' + t('partner.dash_iqd')} style={{ alignItems: 'flex-end' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text variant="numeralLg" color={working ? dash.workingMark : ink} tabular style={{ fontSize: 30, lineHeight: 38, letterSpacing: -0.5 }}>
                  {amountParam(earningsIqd)}
                </Text>
                <Text variant="caption" weight={700} color={ink}>
                  {t('partner.dash_iqd')}
                </Text>
              </View>
              <Text variant="caption" weight={600} color={muted}>
                {t('partner.dash_today')}
              </Text>
            </View>
          </View>
          {working || cut ? (
            <View testID="home-status" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                {working ? (
                  <Animated.View
                    style={[
                      {
                        position: 'absolute',
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        backgroundColor: dash.workingMark,
                      },
                      pulse,
                    ]}
                  />
                ) : null}
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cut ? theme.colors.danger : dash.workingMark }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="footnote" weight={700} color={ink} accessibilityLabel={working && sinceClock ? t('partner.dash_working_a11y', { time: sinceClock }) : undefined}>
                  {cut ? cutTitle : t('partner.dash_working')}
                </Text>
                <Text variant="caption" weight={600} color={muted} tabular numberOfLines={2}>
                  {cut ? cutBody : sinceClock ? t('partner.dash_working_since', { time: sinceClock }) : t('partner.online_body')}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} pointerEvents="box-none">
          <Pressable
            testID="live-day-toggle"
            accessibilityRole="button"
            accessibilityState={{ selected: day }}
            accessibilityLabel={t(day ? 'partner.live_town_a11y' : 'partner.live_my_day_a11y')}
            onPress={onDay}
            hitSlop={6}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.space[3],
              borderRadius: 22,
              backgroundColor: day ? theme.colors.text : theme.colors.surface,
              borderWidth: 1.5,
              borderColor: day ? theme.colors.text : theme.colors.border,
              opacity: pressed ? 0.85 : 1,
              ...shadow,
            })}
          >
            <Icon name={day ? 'map-pin' : 'cash'} size={17} color={day ? 'surface' : 'accentText'} strokeWidth={2.2} />
            <Text variant="label" weight={700} color={day ? 'surface' : 'text'}>
              {t(day ? 'partner.live_town' : 'partner.live_my_day')}
            </Text>
          </Pressable>
          {note ? (
            <View testID="live-note" style={{ flexShrink: 1, paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
              <Text variant="caption" weight={600} color="textMuted">
                {note}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const shadow = {
  shadowColor: palette.neutral[1000],
  shadowOpacity: 0.14,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
};
