import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * With DRIVER_ROLE=web on two machines and a worker on a third, an interval sweep that ignores the
 * role ticks three times: duplicate offers, reminders, bookings and credits. Every repeating timer in
 * the API must therefore stay off on web machines (`runsJobs`), only drive the in-memory queue (which
 * exists only without Redis, i.e. DRIVER_ROLE=all), or be listed here with the reason it runs everywhere.
 */
const RUNS_EVERYWHERE: Record<string, string> = {
  'modules/safety/safety.service.ts': 'SOS sweep: an unanswered SOS must be escalated even if the worker is down; each step is claimed once in the database (repo.claim)',
  'modules/simulator/simulator.service.ts': 'started by hand from the Console, never on boot',
  'modules/events/outbox.publisher.ts': 'started only where events.module checks runsJobs',
};

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('repeating timers respect DRIVER_ROLE', () => {
  it('every setInterval is gated by runsJobs, drives the in-memory queue only, or is listed with a reason', () => {
    const offenders = sources(src)
      .filter((path) => readFileSync(path, 'utf8').includes('setInterval('))
      .map((path) => ({ file: relative(src, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))
      .filter(({ file, text }) => !text.includes('runsJobs(') && !text.includes('instanceof InMemoryQueue') && !(file in RUNS_EVERYWHERE))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('the outbox publisher is really gated where it is started', () => {
    expect(readFileSync(join(src, 'modules/events/events.module.ts'), 'utf8')).toContain('runsJobs(');
  });
});
