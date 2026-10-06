import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Icon, Text, useMotionPresets, useTheme, type IconName } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { routeLabel } from '@/features/rajaa/labels';
import { boardSummary, clockLabel, PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useBoard, useNetwork } from '@/features/rajaa/queries';
import { startRide } from '@/features/ride/WhereToBar';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import type { SearchIntent } from './intents';

type ServiceIntent = Exclude<SearchIntent, { kind: 'meal' }>;

/**
 * «خدمات» (joy h4): what the query means beyond food, above the kitchens — الرجعة with its next car
 * and «احجز», a ride with the destination filled in, or a coming-soon service. Each row has the
 * service's tint and glyph so it never reads like a restaurant.
 */
export function ServiceResults({ intents, onSoon, onPick }: { intents: readonly SearchIntent[]; onSoon: (service: 'grocery' | 'khat' | 'parcel') => void; onPick: () => void }) {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const rows = intents.filter((i): i is ServiceIntent => i.kind !== 'meal');
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: theme.space[3] }} testID="search-services">
      <SectionHeader title={t('search.section_services')} />
      {rows.map((i, n) => (
        <Animated.View key={`${i.kind}-${n}`} entering={presets.panelIn(presets.staggerDelay(n))}>
          {i.kind === 'rajaa' ? (
            <RajaaRow intent={i} onPick={onPick} />
          ) : i.kind === 'ride' ? (
            <ServiceRow
              testID={`search-ride-${i.vertical}`}
              icon={i.vertical === 'tuktuk' ? 'tuktuk-fringe' : 'taxi'}
              title={i.to ? t(i.vertical === 'tuktuk' ? 'search.ride_tuktuk_to' : 'search.ride_taxi_to', { place: i.to.title }) : t(i.vertical === 'tuktuk' ? 'search.ride_tuktuk' : 'search.ride_taxi')}
              subtitle={i.to ? t('search.ride_to_hint') : t('search.ride_hint')}
              onPress={() => {
                onPick();
                startRide(i.vertical, i.to ?? undefined);
              }}
            />
          ) : (
            <ServiceRow
              testID={`search-soon-${i.service}`}
              icon={i.service === 'grocery' ? 'cart' : i.service === 'khat' ? 'clock' : 'parcel'}
              title={t('search.soon_title', { service: t(`home.service_${i.service}` as MessageKey) })}
              subtitle={t('search.soon_hint')}
              muted
              onPress={() => onSoon(i.service)}
            />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

function ServiceRow({ icon, title, subtitle, onPress, muted = false, trailing, testID }: { icon: IconName; title: string; subtitle: string; onPress: () => void; muted?: boolean; trailing?: React.ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}، ${subtitle}`}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 64,
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        backgroundColor: muted ? theme.colors.surfaceSunken : theme.colors.liveTint,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={muted ? 'textMuted' : 'liveText'} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={2} tabular>
          {subtitle}
        </Text>
      </View>
      {trailing ?? <Icon name="chevron-forward" size={18} color="textMuted" />}
    </Pressable>
  );
}

/** «الرجعة لبغداد»: the live count and the next car (signed in), «احجز» opens that board. */
function RajaaRow({ intent, onPick }: { intent: Extract<SearchIntent, { kind: 'rajaa' }>; onPick: () => void }) {
  const theme = useTheme();
  const t = useT();
  const signedIn = useSignedIn();
  const network = useNetwork();
  const corridorId = network.data?.corridors.find((c) => c.cityId === intent.cityId)?.id ?? PRIMARY_CORRIDOR;
  const board = useBoard({ corridorId, direction: intent.direction }, { poll: false });
  const summary = board.data ? boardSummary(board.data.departures, new Date()) : null;
  const subtitle = !signedIn
    ? t('rajaa.home_guest')
    : !summary
      ? t('status.loading')
      : summary.next
        ? t(countKey('rajaa.home_summary', summary.count), { n: summary.count, time: clockLabel(summary.next.departAt) })
        : t('rajaa.home_summary_none');
  const open = () => {
    onPick();
    router.push({ pathname: '/rajaa', params: { corridor: corridorId, direction: intent.direction } });
  };
  return (
    <Card padding={4} elevation={0} style={{ backgroundColor: theme.colors.liveTint }} testID={`search-rajaa-${intent.cityId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="rajaa" size={24} color="liveText" strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={600} color="liveText">
            {t('home.rajaa_title')}
          </Text>
          <Text variant="bodyStrong">{routeLabel(t, intent.cityId, intent.direction)}</Text>
          <Text variant="footnote" color="textMuted" tabular testID="search-rajaa-summary">
            {subtitle}
          </Text>
        </View>
        <Button size="sm" label={t('search.rajaa_book')} onPress={open} testID="search-rajaa-book" />
      </View>
    </Card>
  );
}
