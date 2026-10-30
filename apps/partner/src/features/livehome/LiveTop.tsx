import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color as palette, partnerDash } from '@driver/design-tokens';
import { pluralKey } from '@driver/i18n';
import { Avatar, Icon, Text, usePulse, useTheme } from '@driver/ui';
import { DASH_MAX_WIDTH } from '@/features/home/DashParts';
import type { DashState } from '@/features/home/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The live home's top, as in the concept Ali picked: two pills floating on the map. His state («شغّال ·
 * ندورلك طلب» with a breathing saffron dot, «مو شغّال», or no internet in red), and today's money on an
 * ink pill. Under the money, the «يومي» / «المدينة» switch. Nothing else covers the town.
 */
export function LiveTop({
  state,
  name,
  earningsIqd,
  jobs,
  busyTown,
  cutTitle,
  cutBody,
  day,
  onDay,
  note,
  onLayout,
}: {
  state: DashState;
  name: string | null;
  earningsIqd: number;
  jobs: number;
  /** Kitchens are cooking near him (the waiting pill says «العزيزية تطلب هسة»). */
  busyTown: boolean;
  cutTitle: string;
  cutBody: string;
  day: boolean;
  onDay: () => void;
  /** A quiet line under the pills («بعدك ما وصّلت…»). */
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
  const title = cut ? cutTitle : working ? t('partner.live_on') : t('partner.live_off');
  const sub = cut ? cutBody : working ? t('partner.live_on_sub') : busyTown ? t('partner.live_off_busy') : t('partner.live_off_quiet');
  const pill = { minHeight: 52, borderRadius: 999, ...shadow };
  return (
    <View testID="dash-top" pointerEvents="box-none" onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)} style={{ position: 'absolute', top: 0, start: 0, end: 0, paddingTop: insets.top + theme.space[3], paddingHorizontal: theme.space[3] }}>
      <View pointerEvents="box-none" style={{ width: '100%', maxWidth: DASH_MAX_WIDTH, alignSelf: 'center', gap: theme.space[2] }}>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <View
            testID="home-status"
            accessibilityLiveRegion="polite"
            style={[pill, { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingStart: 6, paddingEnd: theme.space[4], paddingVertical: 6, backgroundColor: cut ? dash.offline : theme.colors.surface }]}
          >
            <Avatar name={name ?? undefined} {...(name ? {} : { icon: 'user' as const })} size={38} tone="accent" />
            <View style={{ flexShrink: 1 }}>
              <Text testID="dash-hello" variant="label" weight={700} color={cut ? dash.onOffline : 'text'} numberOfLines={1}>
                {title}
              </Text>
              <Text variant="caption" weight={600} color={cut ? dash.onOfflineMuted : 'textMuted'} numberOfLines={1}>
                {sub}
              </Text>
            </View>
            {working || cut ? (
              <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginStart: 2 }}>
                {working ? <Animated.View style={[{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.accent }, pulse]} /> : null}
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: cut ? theme.colors.danger : theme.colors.accent }} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }} pointerEvents="none" />
          <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: theme.space[2] }}>
            <View
              testID="today-pill"
              accessible
              accessibilityLabel={t('partner.dash_today') + ' ' + amountParam(earningsIqd) + ' ' + t('partner.dash_iqd')}
              style={[pill, { justifyContent: 'center', paddingHorizontal: theme.space[4], paddingVertical: 6, backgroundColor: theme.colors.text }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <Text variant="title" weight={700} color="bg" tabular style={{ fontSize: 20, lineHeight: 26 }}>
                  {amountParam(earningsIqd)}
                </Text>
                <Text variant="caption" weight={600} color="bg" style={{ fontSize: 12 }}>
                  {t('partner.dash_iqd')}
                </Text>
              </View>
              <Text variant="caption" weight={600} color="bg" style={{ fontSize: 11.5, lineHeight: 15, opacity: 0.78 }} tabular>
                {t(pluralKey('partner.live_today_jobs', jobs), { n: jobs })}
              </Text>
            </View>
            <Pressable
              testID="live-day-toggle"
              accessibilityRole="button"
              accessibilityState={{ selected: day }}
              accessibilityLabel={t(day ? 'partner.live_town_a11y' : 'partner.live_my_day_a11y')}
              onPress={onDay}
              hitSlop={4}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: theme.space[3],
                borderRadius: 22,
                backgroundColor: day ? theme.colors.accent : theme.colors.surface,
                opacity: pressed ? 0.85 : 1,
                ...shadow,
              })}
            >
              <Icon name={day ? 'map-pin' : 'cash'} size={17} color={day ? 'onAccent' : 'accentText'} strokeWidth={2.2} />
              <Text variant="label" weight={700} color={day ? 'onAccent' : 'text'}>
                {t(day ? 'partner.live_town' : 'partner.live_my_day')}
              </Text>
            </Pressable>
          </View>
        </View>
        {note ? (
          <View testID="live-note" style={{ alignSelf: 'flex-end', maxWidth: 300, paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.surface, ...shadow }}>
            <Text variant="caption" weight={600} color="textMuted">
              {note}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const shadow = { shadowColor: palette.neutral[1000], shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 };
