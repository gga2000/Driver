import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { homeSize } from './format';
import { liveAge, liveLabel } from './logic';
import { useHomeLook } from './look';

export interface HomeMapCardProps {
  /** The map itself (a real map from the app, or its still picture when the map can't draw). */
  map: ReactNode;
  /**
   * When the last live update came (ms since epoch); leave out with no order (the tag then names the town).
   * The tag ticks by itself, so the map above it never redraws for the clock.
   */
  updatedAt?: number;
  /** A fixed clock (gallery, tests); leave out in the app. */
  now?: number;
  /** No connection: the tag says so, with how old the picture is. */
  offline?: boolean;
  /** The order ended (cancelled): no map and no live tag, only the panel. */
  frozen?: boolean;
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
export function HomeMapCard({
  map,
  updatedAt,
  now,
  offline,
  frozen,
  town,
  route,
  children,
  mapHeight,
  style,
  testID,
}: HomeMapCardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const routeText = route ? t('home.route', route) : null;
  // The same heights as the loading shape: taller during an order, shorter when quiet.
  const height = mapHeight ?? (route ? homeSize.mapOrder : homeSize.mapIdle);
  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: theme.radius.xl,
          overflow: 'hidden',
          backgroundColor: look.panel.fill,
          boxShadow: look.card.shadow ?? undefined,
          borderWidth: look.card.edge ? 1 : 0,
          borderColor: look.card.edge ?? undefined,
        },
        style,
      ]}
    >
      {/* A cancelled order has nothing to watch: the map steps away and the panel says what comes next. */}
      {frozen ? null : (
        <View style={{ height, backgroundColor: look.map.land, overflow: 'hidden' }}>
          {/*
          The map's name is read first, from its own empty element: wrapping the map in an image role would
          hide its pins from screen readers on the web. The tag and the route are read on their own.
        */}
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              routeText
                ? t('home.map_order_a11y', { route: routeText })
                : t('home.map_town_a11y', { town })
            }
            testID={testID ? `${testID}-map-name` : undefined}
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
          />
          <View style={{ flex: 1 }}>{map}</View>
          <LiveTag
            updatedAt={updatedAt}
            now={now}
            offline={offline}
            town={town}
            testID={testID ? `${testID}-live` : undefined}
          />
          {routeText ? (
            <View
              testID={testID ? `${testID}-route` : undefined}
              style={{
                position: 'absolute',
                bottom: theme.space[3],
                end: theme.space[3],
                paddingHorizontal: theme.space[3],
                paddingVertical: theme.space[1] / 2,
                maxWidth: '70%',
                borderRadius: theme.radius.pill,
                backgroundColor: look.card.fill,
                boxShadow: look.card.shadow ?? undefined,
              }}
            >
              <Text variant="footnote" compact numberOfLines={1}>
                {routeText}
              </Text>
            </View>
          ) : null}
        </View>
      )}
      {children}
    </View>
  );
}

/** Seconds since `updatedAt`, ticking once a second for the first minute, then every 30 s. */
function useAgeSec(
  updatedAt: number | undefined,
  fixedNow: number | undefined,
): number | undefined {
  const [clock, setClock] = useState(() => fixedNow ?? Date.now());
  const age =
    updatedAt === undefined
      ? undefined
      : Math.max(0, Math.floor(((fixedNow ?? clock) - updatedAt) / 1000));
  useEffect(() => {
    if (updatedAt === undefined || fixedNow !== undefined) return;
    const id = setTimeout(() => setClock(Date.now()), (age ?? 0) < 60 ? 1000 : 30_000);
    return () => clearTimeout(id);
  }, [updatedAt, fixedNow, age]);
  return age;
}

/** «مباشر · قبل 8 ثواني» during an order, «مباشر · العزيزية» without; past 2 minutes it says when the last update was. */
export const LiveTag = memo(function LiveTag({
  updatedAt,
  now,
  offline,
  town,
  testID,
}: {
  updatedAt?: number;
  now?: number;
  offline?: boolean;
  town: string;
  testID?: string;
}) {
  const theme = useTheme();
  const look = useHomeLook();
  const ageSec = useAgeSec(updatedAt, now);
  const age = ageSec === undefined ? null : liveAge(ageSec);
  const label = liveLabel(ageSec, !!offline, town);
  // Going stale or offline is news: say it once when it happens, not again every minute the age ticks.
  const worry = !!offline || !!age?.stale;
  const said = useRef(worry);
  useEffect(() => {
    if (worry && !said.current) AccessibilityInfo.announceForAccessibility(label);
    said.current = worry;
  }, [worry, label]);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={label}
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
      <View
        style={{
          width: homeSize.dot,
          height: homeSize.dot,
          borderRadius: homeSize.dot / 2,
          backgroundColor: offline || age?.stale ? look.panel.upcoming : look.live,
        }}
      />
      <Text variant="footnote" color={look.panel.on} compact numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});
