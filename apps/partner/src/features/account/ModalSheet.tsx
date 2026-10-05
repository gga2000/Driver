import type { ReactNode } from 'react';
import { MAX_CONTENT_WIDTH, ModalSheet as SharedModalSheet } from '@driver/ui';

/**
 * A modal bottom sheet for short tasks (the hand-over code, uploading a document): the shared
 * `ModalSheet` (S-12) in the phone column. The scrim, back button and Escape close it unless `locked`.
 */
export function ModalSheet({ visible, onClose, title, children, locked = false, testID }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; locked?: boolean; testID?: string }) {
  return (
    <SharedModalSheet visible={visible} onClose={onClose} title={title} locked={locked} layout="sheet" sheetMaxWidth={MAX_CONTENT_WIDTH} closeButton={false} testID={testID}>
      {children}
    </SharedModalSheet>
  );
}
