import { useEffect, useRef } from 'react';
import { playChatPing } from '@/lib/alert';

/**
 * Partner redesign o15: a new chat message on the job plays its own two-pip sound (not the order's
 * doorbell, not the nudge), so he knows it is a message without looking. Only when the unread count
 * goes up — never on the first read or when he reads them.
 */
export function useChatPing(threads: readonly { unread: number }[] | undefined): void {
  const total = (threads ?? []).reduce((s, th) => s + th.unread, 0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (threads === undefined) return;
    if (last.current !== null && total > last.current) playChatPing();
    last.current = total;
  }, [threads, total]);
}
