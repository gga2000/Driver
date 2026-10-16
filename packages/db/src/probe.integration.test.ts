import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createDbProbe } from './probe.js';

/** The health probe (`health.live`) on a real Postgres. Needs DATABASE_URL; skipped otherwise. */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('createDbProbe (needs DATABASE_URL)', () => {
  const probe = createDbProbe(url ?? '', {}, 1_000);

  afterAll(async () => {
    await probe.close();
  });

  it('answers ok, and a herd of checks shares one query', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => probe.check()));
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('recovers after its connection is killed', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'driver-health-probe' AND datname = current_database()`,
    );
    await admin.end();
    // The first check may see the dead socket; the next one opens a fresh connection.
    await probe.check();
    expect(await probe.check()).toEqual({ ok: true });
  });

  it('says why when the database cannot be reached, without throwing', async () => {
    const dead = createDbProbe('postgresql://nobody:nothing@127.0.0.1:1/none', {}, 500);
    const res = await dead.check();
    expect(res.ok).toBe(false);
    await dead.close();
  });
});
