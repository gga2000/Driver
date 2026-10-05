import type { StyleProp, ViewStyle } from 'react-native';
import type { DepartureCard, RajaaDriverCard } from '@driver/contracts';
import { DriverChip } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { vehicleDesc } from './labels';

/**
 * The driver of a الرجعة car (audit C-19), the same on the board, the seat sheet and the boarding
 * pass: his first name (never an ID code), "متحقق اليوم" after this run's selfie, the car and its
 * plate in a chip. Without his card yet it says "السايق" and still shows the car and plate.
 */
export function RajaaDriver({
  dep,
  card,
  size = 'md',
  eyebrow,
  style,
  testID,
}: {
  dep: Pick<DepartureCard, 'vehicle'>;
  card: RajaaDriverCard | undefined;
  size?: 'md' | 'lg';
  eyebrow?: boolean;
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
      vehicle={vehicleDesc(t, dep.vehicle)}
      plate={dep.vehicle.plate}
      plateLabel={t('driver.plate')}
      verifiedLabel={card?.verifiedTodayAt ? t('trip.verified_today') : null}
      {...(eyebrow ? { eyebrow: t('rajaa.your_driver') } : {})}
      size={size}
      style={style}
    />
  );
}
