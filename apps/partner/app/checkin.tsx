import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** Wave 2: daily selfie check-in with liveness (scoring §2). Replace this file's contents with the real screen. */
export default function CheckIn() {
  const t = useT();
  return <PlaceholderScreen title={t('partner.hub_checkin')} icon="shield" />;
}
