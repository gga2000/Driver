import { router } from 'expo-router';
import { TopUpDesk } from '@/features/ops/TopUpDesk';
import { useStatus } from '@/features/work/queries';
import { useT } from '@/lib/i18n';

/**
 * "الزبون يريد يشحن محفظته" from the job screen: the courier carrying the customer's live order takes
 * the cash and confirms with the 6-digit code from the customer's app (`partner.topUpLookup` →
 * `partner.confirmTopUp`). The cash is booked to him and counts on his cash cap until he settles,
 * so the screen shows the cap before and after.
 */
export default function JobTopUp() {
  const t = useT();
  const status = useStatus();
  return (
    <TopUpDesk
      mode="courier"
      title={t('partner.job_topup_title')}
      cash={status.data?.cash ?? null}
      backLabel={t('partner.job_topup_back')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/job'))}
    />
  );
}
