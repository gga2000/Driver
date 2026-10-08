/**
 * The on-call paging port. The on-call module (the Console's rota) implements it; safety asks it who
 * gets the first page of an incident, after the incident row has committed. Escalation after the
 * first page belongs to the on-call module: safety never re-pages by itself when the rota answered.
 * Absent, failing, slow or empty → safety falls back to paging every live dispatcher (today's
 * behaviour), logged with a stable code. An SOS is never refused whatever the port does.
 */
import type { IncidentForPaging, OnCallPort, PagePlan } from '@driver/contracts';

// The port's types are the contracts' (`on-call-io.ts`), shared with the on-call module that implements it.
export type { IncidentForPaging, OnCallPort, PagePlan } from '@driver/contracts';

/** Optional provider; absent = fallback. */
export const ON_CALL_PORT = Symbol('ON_CALL_PORT');

/** How long the first page waits for the rota before falling back. */
export const ON_CALL_TIMEOUT_MS = 2_000;

/** The stable log code of every fallback (alerts and the desk's runbook grep for it). */
export const ON_CALL_FALLBACK_CODE = 'safety_oncall_fallback';

export type OnCallFallbackReason = 'absent' | 'threw' | 'timeout' | 'empty';

/**
 * The rota's first page, or why it fell back. Never throws and never waits longer than `timeoutMs`.
 */
export async function askOnCall(
  port: OnCallPort | null | undefined,
  incident: IncidentForPaging,
  timeoutMs = ON_CALL_TIMEOUT_MS,
): Promise<{ plan: PagePlan; fallback: null } | { plan: null; fallback: OnCallFallbackReason; error?: string }> {
  if (!port) return { plan: null, fallback: 'absent' };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const answer = await Promise.race([port.firstPage(incident), timeout]);
    if (answer === 'timeout') return { plan: null, fallback: 'timeout' };
    if (!answer || !Array.isArray(answer.staffPersonIds) || answer.staffPersonIds.length === 0) return { plan: null, fallback: 'empty' };
    return { plan: answer, fallback: null };
  } catch (err) {
    return { plan: null, fallback: 'threw', error: (err as Error)?.message ?? String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
