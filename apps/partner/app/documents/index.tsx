import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** Wave 2: documents and expiry reminders (scoring §2). Replace this file's contents with the real screen. */
export default function Documents() {
  const t = useT();
  return <PlaceholderScreen title={t('partner.hub_documents')} icon="receipt" />;
}
