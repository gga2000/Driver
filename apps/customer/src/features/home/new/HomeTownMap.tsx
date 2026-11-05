import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useLiteMode, useNetwork, useNow, useTheme } from '@driver/ui';
import { useCatalogRestaurants, useDeliverTo } from '@/features/food/queries';
import { LIVE_MAP, LiveMap } from '@/features/livemap/LiveMap';
import { bubbleIds, homeOf, livePins } from '@/features/livemap/logic';
import { useTownNow } from '@/features/livemap/queries';
import { useOrderOnMap } from '@/features/livemap/useOrderOnMap';
import { useT } from '@/lib/i18n';

/**
 * The town inside the new home's map card (spec §12.2): the same live map as «العزيزية هسة», drawn
 * still (no pan or zoom) at the card's size, with their order on it while one runs. A tap opens /live
 * (or the order's own screen, `onPress`).
 * Where the map can't run, or fails, the card keeps its land colour and the panel under it.
 * `onUpdated` reports when the town was last read, for the card's live tag.
 */
export function HomeTownMap({ night, onUpdated, onPress }: { night: boolean; onUpdated?: (at: number | undefined) => void; /** Where a tap goes (default /live; the order's screen while one runs). */ onPress?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const lite = useLiteMode();
  const net = useNetwork();
  const now = useNow(true, 30_000);
  const [failed, setFailed] = useState(false);
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
  const updated = town.dataUpdatedAt || undefined;
  useEffect(() => {
    onUpdated?.(updated);
  }, [updated, onUpdated]);
  if (!on || !query.data) return null;
  const order = onMap?.order ?? null;
  const homeLabel = isHome ? (place?.label === 'home' ? t('live_map.home') : t('live_map.your_place')) : null;
  return (
    <Pressable
      testID="home-map-open"
      accessibilityRole="button"
      accessibilityLabel={t('live_map.open')}
      onPress={() => {
        theme.haptic('selection');
        if (onPress) onPress();
        else router.push('/live');
      }}
      style={StyleSheet.absoluteFill}
    >
      <LiveMap
        pins={pins}
        bubbles={bubbles}
        home={order?.door ?? [homeAt.lng, homeAt.lat]}
        homeLabel={order?.door ? t('live_map.door') : homeLabel}
        selectedId={null}
        onSelect={() => undefined}
        order={order}
        topInset={theme.space[10]}
        bottomInset={theme.space[3]}
        lite={lite}
        night={night}
        still
        onFail={() => setFailed(true)}
      />
    </Pressable>
  );
}
