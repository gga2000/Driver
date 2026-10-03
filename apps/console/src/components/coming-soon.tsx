import { t, type MessageKey } from '@driver/i18n';

/** Small, clean placeholder for console sections that land in later Step 8 parts. */
export function ComingSoon({ sectionKey }: { sectionKey: MessageKey }) {
  const section = t(sectionKey);
  return (
    <section className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-card">
      <p className="text-sm text-muted">{section}</p>
      <h1 className="mt-2 font-display text-2xl font-bold">{t('console.coming_soon')}</h1>
      <p className="mt-3 text-sm text-muted">{t('console.coming_soon_hint', { section })}</p>
    </section>
  );
}
