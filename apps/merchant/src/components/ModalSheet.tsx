import { ModalSheet as SharedModalSheet, type ModalSheetProps as SharedProps } from '@driver/ui';
import { useT } from '@/lib/i18n';

export type ModalSheetProps = Omit<SharedProps, 'closeLabel' | 'layout'>;

/**
 * Modal for kitchen decisions (accept, reject, close, busy, order detail): the shared `ModalSheet`
 * (S-12) — a bottom sheet on a phone, a centred dialog on the tablet — closed with "سكّر".
 */
export function ModalSheet(props: ModalSheetProps) {
  const t = useT();
  return <SharedModalSheet {...props} layout="auto" closeLabel={t('merchant.common.close')} />;
}
