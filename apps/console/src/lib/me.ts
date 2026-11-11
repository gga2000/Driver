'use client';

import { useQuery } from '@tanstack/react-query';
import type { RoleKind, SecondStep } from '@driver/contracts';
import { useSignedIn } from './session';
import { useTRPC } from './trpc';

/**
 * The signed-in staff member's active roles (for showing or hiding actions; the API decides anyway), and
 * `secondStep` when admin or finance still owe the authenticator code on this session (docs/api/staff-totp.md).
 */
export function useMyRoles(): { roles: ReadonlySet<RoleKind>; personId: string | null; loaded: boolean; secondStep: SecondStep | null } {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const me = useQuery(trpc.identity.me.queryOptions(undefined, { enabled: signedIn, staleTime: 60_000, retry: false }));
  const roles = new Set<RoleKind>((me.data?.roles ?? []).filter((r) => !r.frozen).map((r) => r.kind));
  return { roles, personId: me.data?.personId ?? null, loaded: me.isSuccess, secondStep: me.data?.secondStep ?? null };
}

export function hasAny(roles: ReadonlySet<RoleKind>, wanted: readonly RoleKind[]): boolean {
  return wanted.some((r) => roles.has(r));
}
