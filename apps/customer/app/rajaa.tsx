import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** STUB — the intercity milestone replaces this with the garage boards and seat booking (spec §2). */
export default function RajaaStub() {
  const t = useT();
  return <PlaceholderScreen title={t('home.rajaa_title')} icon="garage" detail="/rajaa" />;
}
