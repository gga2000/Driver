import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, Text, useLiteMode, useNetwork, useNow, useTheme, withAlpha } from '@driver/ui';
import { useCatalogRestaurants, useDeliverTo } from '@/features/food/queries';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import { LIVE_MAP, LiveMap } from './LiveMap';
import { bubbleIds, headline, homeOf, livePins } from './logic';
import { useTownNow } from './queries';
import { useOrderOnMap } from './useOrderOnMap';

/** The hero's height for a screen: the map shows under the greeting and search, and the first row of services still shows on a small phone (390 × 667). */
export function homeLiveHeight(screenH: number): number {
  return Math.round(Math.min(Math.max(screenH * 0.5, 320), 410));
}

/** Room at the bottom of the hero for its «العزيزية هسة» tag. */
const TAG_ROOM = 56;

export interface HomeLiveProps {
  /** Home's hour: the night map from 18:00 to 06:00 (as the map box). */
  night: boolean;
  /** Page gutter and top padding, so the hero runs edge to edge under the header. */
  gutter: number;
  padTop: number;
  /** The greeting and the search, laid over the map's top. */
  children: ReactNode;
}

/**
 * «العزيزية هسة» at the top of home (Ali, 2026-10-28; the Home thread's terms): the live town around
 * their place behind the greeting and the search, full width, the cream of the page fading into the map
 * under them. It is a picture, not a map to play with: no pan or zoom, and a tap anywhere on it opens
 * /live. With an order on its way it shows that order (their courier on the street, their door). Fixed
 * height from the first frame on the page's cream; where the map can't run (or fails) the header and
 * search sit as they always did. Reduce motion: nothing moves by itself.
 */
export function HomeLive({ night, gutter, padTop, children }: HomeLiveProps) {
  const theme = useTheme();
  const t = useT();
  const lite = useLiteMode();
  const net = useNetwork();
  const now = useNow(true, 30_000);
  const { height: screenH } = useWindowDimensions();
  const [failed, setFailed] = useState(false);
  const [topH, setTopH] = useState(0);
  // A map that failed offline (its tiles cut) gets another go once the net is back.
  useEffect(() => {
    if (net.online) setFailed(false);
  }, [net.online]);
  // Only reads the town while home is the screen in front.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { place, dropoff } = useDeliverTo();
  const { at: homeAt, isHome } = homeOf(dropoff?.pin);
  const query = useCatalogRestaurants();
  const on = LIVE_MAP && !failed;
  const town = useTownNow(homeAt, on && focused && net.online);
  const { onMap } = useOrderOnMap(now);
  const pins = useMemo(() => livePins(query.data ?? [], town.data), [query.data, town.data]);
  const bubbles = useMemo(() => bubbleIds(pins), [pins]);

  const pad = { paddingHorizontal: gutter, paddingTop: padTop };
  if (!on) return <View style={[pad, { marginHorizontal: -gutter, marginTop: -padTop, gap: theme.space[4] }]}>{children}</View>;

  const height = homeLiveHeight(screenH);
  const order = onMap?.order ?? null;
  const top = headline(pins, town.data);
  let line: string;
  if (order) line = t('live_map.order_title');
  else if (!net.online) line = t('live_map.offline');
  else if (town.data && top.cooking) line = t(countKey('live_map.cooking', top.cooking), { n: top.cooking });
  else {
    const open = pins.filter((p) => p.card.open).length;
    line = t(countKey('live_map.open_now', open), { n: open });
  }
  const homeLabel = isHome ? (place?.label === 'home' ? t('live_map.home') : t('live_map.your_place')) : null;
  // The cream holds solid behind the greeting and search, then fades into the map over 64 px.
  const scrimH = topH + 64;
  const solid = topH ? topH / scrimH : 0.8;
  const bg = theme.colors.bg;

  return (
    <View testID="home-live" style={{ marginHorizontal: -gutter, marginTop: -padTop, height, backgroundColor: bg }}>
      <Pressable
        testID="home-live-open"
        accessibilityRole="button"
        accessibilityLabel={`${t('live_map.open')}، ${line}`}
        onPress={() => {
          theme.haptic('selection');
          router.push('/live');
        }}
        style={StyleSheet.absoluteFill}
      >
        {query.data ? (
          <LiveMap
            pins={pins}
            bubbles={bubbles}
            home={order?.door ?? [homeAt.lng, homeAt.lat]}
            homeLabel={order?.door ? t('live_map.door') : homeLabel}
            selectedId={null}
            onSelect={() => undefined}
            order={order}
            topInset={topH}
            bottomInset={TAG_ROOM}
            lite={lite}
            night={night}
            still
            onFail={() => setFailed(true)}
          />
        ) : null}
        <View pointerEvents="none" style={[styles.tag, { bottom: theme.space[3], start: theme.space[5] }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 36, paddingStart: theme.space[3], paddingEnd: theme.space[2], borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.96), boxShadow: '0 2px 8px rgba(40,24,8,0.2)' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: net.online ? theme.colors.live : theme.colors.borderStrong }} />
            <Text variant="caption" weight={700}>
              {t('live_map.title')}
            </Text>
            <Text variant="caption" color="textMuted" tabular numberOfLines={1} style={{ flexShrink: 1 }} testID="home-live-line">
              {line}
            </Text>
            <Icon name="chevron-forward" size={16} color="textMuted" />
          </View>
        </View>
      </Pressable>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: scrimH }}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="home-live-scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={bg} stopOpacity={0.94} />
              <Stop offset={solid} stopColor={bg} stopOpacity={0.82} />
              <Stop offset="1" stopColor={bg} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#home-live-scrim)" />
        </Svg>
      </View>
      <View pointerEvents="box-none" onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))} style={[pad, { gap: theme.space[4] }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', maxWidth: '86%' },
});
