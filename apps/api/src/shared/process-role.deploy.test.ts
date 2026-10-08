import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { processRoleFromEnv } from './process-role.js';

const tomlPath = fileURLToPath(new URL('../../../../deploy/fly/api.toml', import.meta.url));

/** The `[processes]` table of deploy/fly/api.toml: group → command. */
function processes(toml: string): Record<string, string> {
  const section = /^\[processes\]\n([\s\S]*?)(?=^\[)/m.exec(toml)?.[1] ?? '';
  return Object.fromEntries([...section.matchAll(/^\s*(\w+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
}

/**
 * The launch layout lives in a file no unit test runs; this keeps it honest: each process group sets a
 * role the API accepts, a heap cap under its machine's memory, and only `app` takes public traffic.
 */
describe('deploy/fly/api.toml launch layout', () => {
  const toml = readFileSync(tomlPath, 'utf8');
  const groups = processes(toml);

  it('runs a web group and a worker group with roles the API accepts', () => {
    expect(Object.keys(groups).sort()).toEqual(['app', 'worker']);
    const roleOf = (cmd: string) => processRoleFromEnv({ DRIVER_ROLE: /DRIVER_ROLE=(\S+)/.exec(cmd)?.[1], REDIS_URL: 'redis://x' });
    expect(roleOf(groups['app'] ?? '')).toBe('web');
    expect(roleOf(groups['worker'] ?? '')).toBe('worker');
  });

  it('caps each heap at 75 % of its machine', () => {
    const heap = (cmd: string) => Number(/--max-old-space-size=(\d+)/.exec(cmd)?.[1]);
    const vm = (group: string) => {
      const block = new RegExp(`\\[\\[vm\\]\\]\\s*\\n\\s*processes = \\["${group}"\\][\\s\\S]*?memory = "(\\d+)gb"`).exec(toml);
      return Number(block?.[1]) * 1024;
    };
    for (const g of ['app', 'worker']) expect(heap(groups[g] ?? '')).toBe(vm(g) * 0.75);
  });

  it('sends public traffic to app only, and health-checks the worker', () => {
    expect(/\[http_service\][\s\S]*?processes = \["app"\]/.exec(toml)).not.toBeNull();
    expect(/\[checks\.\w+\]\s*\n\s*processes = \["worker"\]/.exec(toml)).not.toBeNull();
  });
});
