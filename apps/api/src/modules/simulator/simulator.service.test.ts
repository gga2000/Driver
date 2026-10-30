import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatorService } from './simulator.service.js';

/** The live run's guard only; the run itself is covered by `pnpm sim` and the invariants test. */
function service(): SimulatorService {
  const none = undefined as never;
  return new SimulatorService(none, none, none, none, none, none, none, none, none, none, none, none, none, none, none);
}

const input = { cityId: 'aziziyah', drivers: 10, ordersPerHour: 30 };

describe('live simulator: local and staging only', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('on production it is not offered and refuses to start, before it signs anyone in', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEPLOY_ENVIRONMENT', '');
    const sim = service();
    expect(sim.status().available).toBe(false);
    await expect(sim.start(input)).rejects.toMatchObject({ code: 'dev_only' });
    vi.stubEnv('DEPLOY_ENVIRONMENT', 'production');
    await expect(sim.start(input)).rejects.toMatchObject({ code: 'dev_only' });
  });

  it('is offered locally and on staging', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEPLOY_ENVIRONMENT', 'staging');
    expect(service().status().available).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEPLOY_ENVIRONMENT', '');
    expect(service().status().available).toBe(true);
  });
});
