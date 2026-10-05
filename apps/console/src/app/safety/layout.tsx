import type { ReactNode } from 'react';
import { SafetyDesk } from '@/components/safety/desk';

/** The emergencies desk stays mounted across /safety and /safety/[id]; the pages only set the route. */
export default function SafetyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SafetyDesk />
      {children}
    </>
  );
}
