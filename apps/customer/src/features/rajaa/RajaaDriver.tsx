import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { DepartureCard, RajaaDriverCard } from '@driver/contracts';
import { DriverChip } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { vehicleDesc } from './labels';

/**
 * The driver of a الرجعة car (audit C-19), the same on the board, the seat sheet and the boarding
 * pass, the request board's offers and the claimed seat (R-01, R-02): his first name (never an ID
 * code), "متحقق اليوم" after a selfie check-in today, the car and its plate in a chip. Without his
 * card yet it says "السايق" and still shows the car and plate.
 */
export function RajaaDriver({
  dep,
  card,
  size = 'md',
  eyebrow,
  trailing,
  style,
  testID,
}: {
  /** The car: a departure's, or (request board) the offering driver's latest one; null when unknown. */
  dep: { vehicle: DepartureCard['vehicle'] | null };
  card: Pick<RajaaDriverCard, 'firstName' | 'verifiedTodayAt' | 'photoUrl'> | null | undefined;
  size?: 'md' | 'lg';
  eyebrow?: boolean;
  /** Beside the card (the request board: nothing; kept for rows that need an action). */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useT();
  return (
    <DriverChip
      testID={testID}
      name={card?.firstName ?? t('rajaa.driver_unnamed')}
      unnamed={!card?.firstName}
      photoUrl={card?.photoUrl ?? null}
      vehicle={dep.vehicle ? vehicleDesc(t, dep.vehicle) : null}
      plate={dep.vehicle?.plate ?? null}
      plateLabel={t('driver.plate')}
      verifiedLabel={card?.verifiedTodayAt ? t('trip.verified_today') : null}
      {...(eyebrow ? { eyebrow: t('rajaa.your_driver') } : {})}
      size={size}
      trailing={trailing}
      style={style}
    />
  );
}
