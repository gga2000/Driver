import { View } from 'react-native';
import type { GarageTaxiLink } from '@driver/contracts';
import { formatClock, Icon, STATUS_TONES, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { lateNoticeShown } from './garage-taxi';
import { useGarageLate } from './garage-taxi-queries';
import { garageLabel } from './GarageTaxiParts';

/**
 * Taxi idea x3 on the live ride screen: this ride is the taxi we booked to his الرجعة car, and it
 * would bring him after the car's time. Says by how much, the car's time and his arrival, and whether
 * the car's driver was told. Nothing for any other ride, nor while it is on time. Offline it keeps
 * the last answer (the query's cache) — the server told the driver either way.
 */
export function GarageLateNotice({ orderId, testID = 'garage-late-notice' }: { orderId: string; testID?: string }) {
  const q = useGarageLate(orderId);
  return <GarageLateNoticeView link={q.data ?? null} testID={testID} />;
}

/** The notice for a given link (the preview route renders it). */
export function GarageLateNoticeView({ link, testID = 'garage-late-notice' }: { link: GarageTaxiLink | null; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (!lateNoticeShown(link)) return null;
  const tone = STATUS_TONES.warning;
  const garage = garageLabel(link.garage.nameAr);
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors[tone.bg] }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
        <Icon name="clock" size={20} color={tone.fg} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <Text variant="bodyStrong" color={tone.fg}>
          {t('gtaxi.late_title', { garage, minutes: link.lateMin })}
        </Text>
        <Text variant="body" color="text">
          {link.driverTold ? t('gtaxi.late_told', { minutes: link.toldMin ?? link.lateMin }) : t('gtaxi.late_not_told')}
        </Text>
        {link.expectedAt ? (
          <Text variant="caption" color="textMuted" tabular>
            {t('gtaxi.late_times', { depart: formatClock(link.departAt, { locale }), arrive: formatClock(link.expectedAt, { locale }) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
