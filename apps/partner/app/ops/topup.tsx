import { router } from 'expo-router';
import { TopUpDesk } from '@/features/ops/TopUpDesk';
import { useT } from '@/lib/i18n';

/**
 * شحن محفظة زبون — the cash top-up desk of Ops mode (money §4 channel 3). `ops.confirmTopUp` credits
 * the wallet once (single-use code, 24 h) and books the cash to the company.
 */
export default function OpsTopUp() {
  const t = useT();
  return (
    <TopUpDesk
      mode="ops"
      title={t('partner.ops_topup_title')}
      backLabel={t('partner.ops_back_home')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/ops'))}
    />
  );
}
