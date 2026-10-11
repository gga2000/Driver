import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { DepartureCard } from '@driver/contracts';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, EmptyState, IconButton, Text, useLiteMode, useNetwork, useTheme, withAlpha } from '@driver/ui';
import { DepartureTile } from '@/features/rajaa/DepartureTile';
import { GARAGE_LOT_MAP, GarageLot } from '@/features/rajaa/GarageLot';
import type { SeatColours } from '@/features/rajaa/garage-lot-types';
import { garageKey, garageLot } from '@/features/rajaa/garage-cars';
import { seatsLeftLabel } from '@/features/rajaa/labels';
import { clockLabel } from '@/features/rajaa/logic';
import { garageName, useDriverCards, useGarageBoard, useNetwork as useRajaaNetwork } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { useT } from '@/lib/i18n';

const TOP_BAR = 56;
/** The car strip and the hint under the map when no car is chosen. */
const STRIP_H = 112;

/**
 * «مقاعد تشوفها بالكراج» (map idea N12, Ali 2026-10-11): one garage on the Golden hour map, the cars
 * standing in its bays with a bar of seats over each, gold free and brown taken, from the live board.
 * Tap a car (its bar, its time chip, or its chip in the strip) and its card comes up with «احجز بهاي
 * السيارة», which opens the same seat booking as the board. A build without the map, or a map that
 * fails, sends the rider back to the list.
 */
export default function GarageLotScreen() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const lite = useLiteMode();
  const net = useNetwork();
  const params = useLocalSearchParams<{ id: string; corridor?: string; direction?: string }>();
  const garageId = params.id ?? '';
  const key = garageKey(garageId);
  const now = useNow(15_000);
  const network = useRajaaNetwork();
  const board = useGarageBoard(garageId, params.corridor || undefined);
  const deps = useMemo(() => garageLot(board.data?.departures ?? [], garageId, now), [board.data, garageId, now]);
  const drivers = useDriverCards(deps.map((d) => d.id));
  const labelOf = useCallback(
    (d: DepartureCard) => {
      const time = clockLabel(d.departAt);
      return { label: time, a11y: t('rajaa_garage.car_label', { time, seats: seatsLeftLabel(t, d.fill.free) }) };
    },
    [t],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [cardH, setCardH] = useState(320);
  const selected = deps.find((d) => d.id === selectedId) ?? null;
  // Optional reads: without the network the title is «الكراج»; without driver cards the card shows no driver line.
  const title = (network.isError ? '' : garageName(network.data, garageId)) || t('rajaa_garage.title');
  const toList = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/rajaa', params: { ...(params.corridor ? { corridor: params.corridor } : {}), ...(params.direction ? { direction: params.direction } : {}) } });

  const fallback = (heading: string, body?: string) => (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + TOP_BAR, justifyContent: 'center' }}>
      <EmptyState icon="garage" title={heading} {...(body ? { body } : {})} action={{ label: t('rajaa_garage.see_list'), onPress: toList }} />
    </View>
  );

  const legend = (c: SeatColours) => (
    <View pointerEvents="none" style={[styles.legend, { top: insets.top + TOP_BAR + theme.space[1], paddingHorizontal: theme.space[3] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.surface, 0.94) }}>
        {[
          { colour: c.free, label: t('rajaa_garage.legend_free') },
          { colour: c.taken, label: t('rajaa_garage.legend_taken') },
        ].map((x) => (
          <View key={x.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: x.colour }} />
            <Text variant="caption" weight={600}>
              {x.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  // What the pill under the map says while no car is chosen.
  const status = !net.online ? t('net.offline') : board.isPending ? '…' : deps.length ? t('rajaa_garage.hint') : t('rajaa_garage.no_cars');

  let body: React.ReactNode;
  if (!GARAGE_LOT_MAP || !key) body = fallback(title, t('rajaa_garage.phone_soon'));
  else if (failed) body = fallback(t('rajaa_garage.error'));
  else if (board.isError && !board.data) {
    body = (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', paddingTop: insets.top + TOP_BAR }}>
        <EmptyState icon="refresh" title={t('rajaa.load_failed')} action={{ label: t('action.retry'), onPress: () => void board.refetch() }} />
      </View>
    );
  } else {
    body = (
      <>
        <GarageLot
          lotKey={key}
          garageId={garageId}
          departures={deps}
          labelOf={labelOf}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          topInset={insets.top + TOP_BAR + 36}
          bottomInset={(selected ? cardH : STRIP_H) + insets.bottom}
          lite={lite}
          onFail={() => setFailed(true)}
          {...(deps.length ? { legend } : {})}
        />
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + theme.space[3], gap: theme.space[2] }]}>
          {selected ? (
            <View style={{ paddingHorizontal: theme.space[3], gap: theme.space[2] }} onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height) + theme.space[3])} testID="garage-car-card">
              <DepartureTile dep={selected} now={now} driver={drivers.isError ? undefined : drivers.data?.get(selected.id)} />
              <Button
                label={t('rajaa_garage.book')}
                icon="seat"
                fullWidth
                onPress={() => router.push({ pathname: '/rajaa/departure/[id]', params: { id: selected.id, corridor: selected.corridorId, direction: selected.direction } })}
                testID="garage-book"
              />
            </View>
          ) : (
            <>
              <View style={{ alignSelf: 'center', paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.surface, 0.95) }}>
                <Text variant="footnote" weight={600} testID="garage-hint">
                  {status}
                </Text>
              </View>
              {deps.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[3] }}>
                  {deps.map((d) => {
                    const c = labelOf(d);
                    return <Chip key={d.id} role="button" label={`${c.label} · ${seatsLeftLabel(t, d.fill.free)}`} accessibilityLabel={c.a11y} onPress={() => setSelectedId(d.id)} testID={`garage-car-chip-${d.id}`} />;
                  })}
                </ScrollView>
              ) : null}
            </>
          )}
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      {/* Top bar: back and the garage's name; «رجوع للكراج» while a car is open. */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + theme.space[2], paddingHorizontal: theme.space[3], gap: theme.space[2] }]}>
        <View style={{ borderRadius: 22, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
          <IconButton
            icon="arrow-back"
            variant="plain"
            accessibilityLabel={selected ? t('rajaa_garage.back_to_lot') : t('action.back')}
            onPress={() => (selected ? setSelectedId(null) : toList())}
            testID="header-back"
          />
        </View>
        <View style={{ flexShrink: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  legend: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
