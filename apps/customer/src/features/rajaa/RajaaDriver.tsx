import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { DepartureCard, RajaaDriverCard } from '@driver/contracts';
import { DriverChip, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { DriverRecord } from './DriverRecord';
import { vehicleDesc } from './labels';
import { apiPhoto } from '@/lib/photo';

/**
 * The driver of a الرجعة car (audit C-19), the same on the board, the seat sheet and the boarding
 * pass, the request board's offers and the claimed seat (R-01, R-02): his first name (never an ID
 * code), "متحقق اليوم" after a selfie check-in today, the car and its plate in a chip. Without his
 * card yet it says "السايق" and still shows the car and plate. With `record` (seat sheet, boarding
 * pass: x16) his record and «ملفه» follow under the chip.
 */
export function RajaaDriver({
  dep,
  card,
  size = 'md',
  eyebrow,
  trailing,
  record,
  style,
  testID,
}: {
  /** The car: a departure's, or (request board) the offering driver's latest one; null when unknown. */
  dep: { vehicle: DepartureCard['vehicle'] | null };
  card: (Pick<RajaaDriverCard, 'firstName' | 'verifiedTodayAt' | 'photoUrl'> & Partial<Pick<RajaaDriverCard, 'stats'>>) | null | undefined;
  /** Show his record and «ملفه» for this departure (needs the card's stats). */
  record?: { departureId: string };
  size?: 'md' | 'lg';
  eyebrow?: boolean;
  /** Beside the card (the request board: nothing; kept for rows that need an action). */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useT();
  const theme = useTheme();
  const name = card?.firstName ?? t('rajaa.driver_unnamed');
  const chip = (
    <DriverChip
      testID={testID}
      name={name}
      unnamed={!card?.firstName}
      photoUrl={apiPhoto(card?.photoUrl)}
      vehicle={dep.vehicle ? vehicleDesc(t, dep.vehicle) : null}
      plate={dep.vehicle?.plate ?? null}
      plateLabel={t('driver.plate')}
      verifiedLabel={card?.verifiedTodayAt ? t('trip.verified_today') : null}
      {...(eyebrow ? { eyebrow: t('rajaa.your_driver') } : {})}
      size={size}
      trailing={trailing}
      style={record && card?.stats ? undefined : style}
    />
  );
  if (!record || !card?.stats) return chip;
  return (
    <View style={[{ gap: theme.space[4] }, style]}>
      {chip}
      <DriverRecord stats={card.stats} departureId={record.departureId} driverName={name} {...(testID ? { testID: `${testID}-record` } : {})} />
    </View>
  );
}
