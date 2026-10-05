import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { EtaService } from './eta.service.js';
import { OSRM_DEFAULT_TIMEOUT_MS, OsrmRouter } from './osrm.router.js';
import { ResilientRouter } from './resilient.router.js';
import { ROUTER, type Router } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';

/** Routers from the environment: `OSRM_URL` (e.g. http://driver-osrm.internal:5000) turns on road routing. */
export function routerFromEnv(clock: Clock, env: NodeJS.ProcessEnv = process.env): Router {
  const url = env['OSRM_URL'];
  if (!url) return new StraightLineRouter();
  const timeout = Number(env['OSRM_TIMEOUT_MS'] ?? OSRM_DEFAULT_TIMEOUT_MS);
  return new ResilientRouter(new OsrmRouter(url, Number.isFinite(timeout) && timeout > 0 ? timeout : OSRM_DEFAULT_TIMEOUT_MS), new StraightLineRouter(), clock);
}

/** Road routing and the one ETA service (maps program SP4b). */
@Module({
  providers: [{ provide: ROUTER, useFactory: (clock: Clock) => routerFromEnv(clock), inject: [CLOCK] }, EtaService],
  exports: [EtaService, ROUTER],
})
export class RoutingModule {}
