import { useState } from 'react';
import { Button } from '@driver/ui';
import { useT } from '@/lib/i18n';
import type { ShareMoment } from './share-card';
import { ShareCardPanel } from './ShareCardPanel';

/** «شارك الفرحة» (joy l5) as one button and its sheet: the hook point a screen mounts after a good moment. */
export function ShareMomentButton({ moment, id }: { moment: ShareMoment; id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" fullWidth icon="heart" label={t('sharecard.action')} onPress={() => setOpen(true)} testID="share-moment" />
      <ShareCardPanel moment={moment} id={id} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
