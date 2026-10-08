/**
 * What one API process does (`DRIVER_ROLE`, docs/deploy/hosting.md "Web and worker machines").
 *
 * - `all` (default, today's behaviour): serves HTTP and runs every background job — BullMQ workers
 *   (outbox, dispatch waves, order/trip/khat timers, notify, nightly close) and the interval sweeps
 *   (retention purges, the SOS sweep, the outbox tick).
 * - `web`: serves HTTP only. It still *enqueues* jobs (an order placed here queues its timer), but no
 *   BullMQ worker is attached and no sweep runs, so a burst of jobs never slows a request.
 * - `worker`: runs the jobs. It still listens on PORT so the host can health-check it, but it gets
 *   no public traffic (deploy/fly/api.toml gives the `worker` process group no [http_service]).
 *
 * Splitting needs Redis: a `web` process hands its jobs to a `worker` through BullMQ, so `web` and
 * `worker` without REDIS_URL refuse to boot. Switching back is `DRIVER_ROLE=all` (plan 7.6).
 */
export type ProcessRole = 'web' | 'worker' | 'all';

export const PROCESS_ROLES: readonly ProcessRole[] = ['web', 'worker', 'all'];

/** Injection token; InfraModule binds it from the environment. */
export const PROCESS_ROLE = Symbol('PROCESS_ROLE');

/** Reads and checks `DRIVER_ROLE`. Throws (boot fails with the message) on a value that would run wrong. */
export function processRoleFromEnv(env: Record<string, string | undefined> = process.env): ProcessRole {
  const raw = (env['DRIVER_ROLE'] ?? '').trim().toLowerCase();
  if (raw === '') return 'all';
  if (!(PROCESS_ROLES as readonly string[]).includes(raw)) {
    throw new Error(`DRIVER_ROLE must be one of ${PROCESS_ROLES.join(', ')} (got "${env['DRIVER_ROLE']}")`);
  }
  const role = raw as ProcessRole;
  if (role !== 'all' && !env['REDIS_URL']) {
    throw new Error(`DRIVER_ROLE=${role} needs REDIS_URL: web and worker processes hand jobs to each other through Redis`);
  }
  return role;
}

/** True when this process runs background work: BullMQ workers and interval sweeps. */
export function runsJobs(role: ProcessRole): boolean {
  return role !== 'web';
}
