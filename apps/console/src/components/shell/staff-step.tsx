'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { StaffTotpLockView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { formatClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { IconLock } from '../ui';

const ROW_H = 44;
const LOCK_POLL_MS = 30_000;
const NONE: StaffTotpLockView[] = [];

/**
 * The staff authenticator on every page (docs/api/staff-totp.md):
 * - a session that still owes the admin/finance second step goes back to the sign-in page for it;
 * - admins see a row per staff member locked out by 5 wrong codes in a row, until the lock ends
 *   (the server raises the same as a push to admins). Its height is published as `--totp-h`.
 */
export function StaffStepWatch() {
  const router = useRouter();
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded, secondStep } = useMyRoles();
  useEffect(() => {
    if (secondStep) router.replace('/login');
  }, [secondStep, router]);
  const allowed = signedIn && loaded && !secondStep && roles.has('admin');
  const q = useQuery(trpc.identity.authenticator.locks.queryOptions(undefined, { enabled: allowed, refetchInterval: LOCK_POLL_MS, retry: queryRetry }));
  const rows = allowed ? (q.data ?? NONE) : NONE;

  useEffect(() => {
    const root = document.documentElement;
    if (rows.length > 0) root.style.setProperty('--totp-h', `${rows.length * ROW_H}px`);
    else root.style.removeProperty('--totp-h');
    return () => {
      root.style.removeProperty('--totp-h');
    };
  }, [rows.length]);

  if (rows.length === 0) return null;
  return <StaffLockRows rows={rows} />;
}

/** «فلان: 5 رموز مصادقة غلط ورا بعض، دخوله مقفول لحد 3:40» and the way to the staff page. */
export function StaffLockRows({ rows }: { rows: readonly StaffTotpLockView[] }) {
  return (
    <div role="alert" data-testid="totp-locks" className="shrink-0 border-b border-warn/50 bg-warn-tint text-text">
      {rows.map((r) => (
        <Link key={r.personId} href="/staff" className="flex h-11 items-center gap-3 px-4 hover:bg-warn/10 lg:px-8">
          <IconLock size={18} className="shrink-0 text-warn" />
          <p className="num min-w-0 flex-1 truncate text-sm font-semibold">
            {t('console.totp_locked', { name: r.displayName ?? t('console.staff_unknown'), time: formatClock(new Date(r.lockedUntil)) })}
          </p>
        </Link>
      ))}
    </div>
  );
}
