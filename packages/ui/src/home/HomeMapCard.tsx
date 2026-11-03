import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { liveAge } from './logic';
import { useHomeLook } from './look';

export interface HomeMapCardProps {
  /** The map itself (a real map from the app, or its still picture when the map can't draw). */
  map: ReactNode;
  /** Seconds since the last live update; leave out with no order (the tag then names the town). */
  ageSec?: number;
  /** The town on the idle tag («مباشر · العزيزية»). */
  town: string;
  /** «مطعم خالد» → «البيت» during an order. */
  route?: { from: string; to: string };
  /** The panel under the map: `OrderPanel`, `OffersPanel` or `CalmPanel`. */
  children?: ReactNode;
  mapHeight?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The map card at the top of the new home (spec §12.2 item 4–5): the same card with or without an order,
 * in both themes. The map is a slot; the card draws the live tag (with how old the update is), the route
 * label and the panel joined underneath.
 */
export function HomeMapCard({ map, ageSec, town, route, children, mapHeight = 200, style, testID }: HomeMapCardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const routeText = route ? t('home.route', route) : null;
  return (
    <View
      testID={testID}
      style={[{ borderRadius: theme.radius['2xl'], overflow: 'hidden', borderWidth: 1, borderColor: look.edge, backgroundColor: look.panel.fill }, style]}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={routeText ? t('home.map_order_a11y', { route: routeText }) : t('home.map_town_a11y', { town })}
        style={{ height: mapHeight, backgroundColor: look.map.land, overflow: 'hidden' }}
      >
        {map}
        <LiveTag ageSec={ageSec} town={town} />
        {routeText ? (
          <View
            testID={testID ? `${testID}-route` : undefined}
            style={{
              position: 'absolute',
              bottom: theme.space[3],
              end: theme.space[3],
              paddingHorizontal: theme.space[3],
              paddingVertical: 2,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: look.edge,
            }}
          >
            <Text variant="footnote" compact numberOfLines={1}>
              {routeText}
            </Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** «مباشر · قبل 8 ثواني» during an order, «مباشر · العزيزية» without; past 2 minutes it says when the last update was. */
export function LiveTag({ ageSec, town }: { ageSec?: number; town: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const age = ageSec === undefined ? null : liveAge(ageSec);
  const label =
    age === null
      ? t('home.live_town', { town })
      : age.stale
        ? t('home.live_stale', { n: age.n })
        : age.unit === 'now'
          ? t('home.live_now')
          : t(age.unit === 'sec' ? 'home.live_sec' : 'home.live_min', { n: age.n });
  return (
    <View
      testID="home-live-tag"
      style={{
        position: 'absolute',
        top: theme.space[3],
        start: theme.space[3],
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.space[3],
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: look.panel.fill,
        borderWidth: look.panel.edge ? 1 : 0,
        borderColor: look.panel.edge ?? undefined,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: age?.stale ? look.panel.upcoming : look.live }} />
      <Text variant="footnote" color={look.panel.on} compact numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
