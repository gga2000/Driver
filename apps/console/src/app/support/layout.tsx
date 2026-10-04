import type { ReactNode } from 'react';
import { SupportDesk } from '@/components/support/desk';

/** The desk stays mounted across /support and /support/[id]; the pages only set the route. */
export default function SupportLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SupportDesk />
      {children}
    </>
  );
}
