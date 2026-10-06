import { View } from 'react-native';
import type { BookingView, RajaaDriverCard } from '@driver/contracts';
import { Card, DepartureTime, Icon, Rule, StatusPill, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { seatsList } from './labels';

/** Notch size: half of it bites into each side of the ticket at the perforation. */
const NOTCH = 24;

/**
 * The ticket's tear line (joy r3, audit S-2): a dashed rule with a round notch bitten out of each
 * side, in the screen's paper colour, so the pass reads as a ticket you hold, not a card.
 */
export function Perforation({ tint }: { /** Paper behind the ticket (default the screen background). */ tint?: string }) {
  const theme = useTheme();
  const bg = tint ?? theme.colors.bg;
  const notch = { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: bg };
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', height: NOTCH }}>
      <View style={[notch, { marginStart: -NOTCH / 2 }]} />
      <View style={{ flex: 1, paddingHorizontal: theme.space[2] }}>
        <Rule kind="dashed" color="borderStrong" />
      </View>
      <View style={[notch, { marginEnd: -NOTCH / 2 }]} />
    </View>
  );
}

/**
 * The stub kept after the trip (r3): the same ticket, quieter — route, the day and time it left,
 * seat, garage and driver, «تذكرة محفوظة». Nothing on it can be used again (no PIN).
 */
export function KeptStub({ booking, route, garage, driver }: { booking: BookingView; route: string; garage: string; driver: Pick<RajaaDriverCard, 'firstName'> | null | undefined }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const rows: { icon: 'seat' | 'garage' | 'user'; label: string; value: string }[] = [
    { icon: 'seat', label: t('rajaa.seat_label'), value: seatsList(t, booking.seatIds) },
    { icon: 'garage', label: t('rajaa.garage_label'), value: garage },
    ...(driver?.firstName ? [{ icon: 'user' as const, label: t('rajaa.your_driver'), value: driver.firstName }] : []),
  ];
  return (
    <Card padding={0} elevation={0} tone="sunken" testID="rajaa-kept-stub" accessibilityLabel={`${t('rajaa.pass_kept')}، ${route}`}>
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {route}
          </Text>
          <StatusPill size="sm" tone="neutral" icon="receipt" label={t('rajaa.pass_kept')} />
        </View>
        <DepartureTime testID="rajaa-kept-time" at={booking.departure.departAt} size="compact" countdown={false} passStyle pastWarning={false} tone="ink" locale={locale} />
      </View>
      <Perforation tint={theme.colors.bg} />
      <View style={{ padding: theme.space[4], flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.space[3], columnGap: theme.space[3] }}>
        {rows.map((r) => (
          <View key={r.icon} style={{ flexBasis: '30%', flexGrow: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={r.icon} size={14} color="textMuted" />
              <Text variant="caption" color="textMuted">
                {r.label}
              </Text>
            </View>
            <Text variant="label" weight={600} color="textMuted">
              {r.value}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
