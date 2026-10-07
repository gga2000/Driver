import { useEffect } from 'react';
import type { PartnerStatus } from '@driver/contracts';
import { syncBackgroundLocation } from '@/lib/background-location';
import { useT } from '@/lib/i18n';

/**
 * Keeps the OS background location service in step with the shift: on while he is online or on a job,
 * off when he goes offline (maps program SP1 f2). Mounted app-wide next to `useJobPositions`.
 */
export function useBackgroundLocation(status: PartnerStatus | undefined): void {
  const t = useT();
  const online = status?.online ?? false;
  const onJob = Boolean(status?.activeTripId);
  const vehicleClass = status?.vehicleClass ?? null;
  useEffect(() => {
    if (!status) return;
    void syncBackgroundLocation(
      { online, onJob, vehicleClass },
      {
        notificationTitle: t('partner.bg_location_notification_title'),
        notificationBody: t('partner.bg_location_notification_body'),
        disclosureTitle: t('partner.bg_location_disclosure_title'),
        disclosureBody: t('partner.bg_location_disclosure_body'),
        disclosureAllow: t('partner.bg_location_disclosure_allow'),
        disclosureLater: t('partner.bg_location_disclosure_later'),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(status), online, onJob, vehicleClass]);
}
