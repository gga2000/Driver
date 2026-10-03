import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** Wave 2: reliability index and nudges, visible from day 31 (scoring §1). Replace this file's contents with the real screen. */
export default function Scorecard() {
  const t = useT();
  return <PlaceholderScreen title={t('partner.hub_scorecard')} icon="star" />;
}
