import { router } from 'expo-router';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { RajaaDriverBadge, RajaaDriverStats } from '@driver/contracts';
import { Icon, StatStrip, StatusPill, Text, useTheme, AnimatedPressable, usePressScale } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { BADGE_ICON, badgeCopy, peopleSay, recordFacts, rodeBefore } from './driver-record';

/** Earned badges read warm; the driver's own word for his car reads plain. */
const EARNED: readonly RajaaDriverBadge[] = ['top_driver', 'family_trusted'];

/** The driver's badges as small pills (earned first, as the server orders them). */
export function DriverBadges({ badges, testID }: { badges: readonly RajaaDriverBadge[]; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  if (badges.length === 0) return null;
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {badges.map((b) => (
        <StatusPill key={b} testID={testID ? `${testID}-${b}` : undefined} size="sm" tone={EARNED.includes(b) ? 'accent' : 'neutral'} icon={BADGE_ICON[b]} label={badgeCopy(t, b).title} />
      ))}
    </View>
  );
}

/** «سافرت وياه قبل» (x17) as a quiet green pill; nothing when the rider never did. */
export function RodeBefore({ n, testID }: { n: number; testID?: string }) {
  const t = useT();
  const label = rodeBefore(t, n);
  return label ? <StatusPill testID={testID} size="sm" tone="success" icon="check" label={label} /> : null;
}

/**
 * Under «سايقك» on the seat sheet and the boarding pass (x16): his rating, trips and on-time share in
 * one strip, what riders say most, his badges, «سافرت وياه قبل», and «ملفه» to the full profile.
 */
export function DriverRecord({
  stats,
  departureId,
  driverName,
  style,
  testID = 'driver-record',
}: {
  stats: RajaaDriverStats;
  /** The run he drives: the profile is asked by departure. */
  departureId: string;
  driverName: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const press = usePressScale(0.98);
  const say = peopleSay(t, stats);
  return (
    <View testID={testID} style={[{ gap: theme.space[3] }, style]}>
      <StatStrip items={recordFacts(t, stats, testID)} />
      {say ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="chat" size={16} color="textMuted" />
          <Text testID={`${testID}-say`} variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {say}
          </Text>
        </View>
      ) : null}
      {stats.badges.length > 0 || stats.ridesWithYou > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <RodeBefore n={stats.ridesWithYou} testID={`${testID}-rode`} />
          <DriverBadges badges={stats.badges} testID={`${testID}-badges`} />
        </View>
      ) : null}
      <AnimatedPressable
        testID={`${testID}-open`}
        accessibilityRole="link"
        accessibilityLabel={t('rajaa.profile_open_a11y', { name: driverName })}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/rajaa/driver/[id]', params: { id: departureId } })}
        style={[
          {
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.space[1],
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
          },
          press.style,
        ]}
      >
        <Text variant="label" weight={700} color="accentText">
          {t('rajaa.profile_open')}
        </Text>
        <Icon name="chevron-forward" size={16} color="accentText" />
      </AnimatedPressable>
    </View>
  );
}
