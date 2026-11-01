import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { ClosureAwareRouter } from './closure-aware.router.js';
import { RouteClosures } from './closures.js';
import { EtaService } from './eta.service.js';
import { OSRM_DEFAULT_TIMEOUT_MS, OsrmRouter } from './osrm.router.js';
import { ResilientRouter } from './resilient.router.js';
import { ROUTER, type Router } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';
import { StreetShapeRouter } from './street-shape.router.js';

/**
 * Routers from the environment: `OSRM_URL` (e.g. http://driver-osrm.internal:5000) turns on road routing.
 * Without it (or while it is down) times are the straight-line estimate, and the route line still follows
 * our map's streets (StreetShapeRouter, Ali 2026-11-01).
 */
export function routerFromEnv(clock: Clock, env: NodeJS.ProcessEnv = process.env): Router {
  const url = env['OSRM_URL'];
  const estimate = new StreetShapeRouter(new StraightLineRouter());
  if (!url) return estimate;
  const timeout = Number(env['OSRM_TIMEOUT_MS'] ?? OSRM_DEFAULT_TIMEOUT_MS);
  return new ResilientRouter(new OsrmRouter(url, Number.isFinite(timeout) && timeout > 0 ? timeout : OSRM_DEFAULT_TIMEOUT_MS), estimate, clock);
}

/** Road routing and the one ETA service (maps program SP4b); every route goes around today's closed streets (N20). */
@Module({
  providers: [
    RouteClosures,
    { provide: ROUTER, useFactory: (clock: Clock, closures: RouteClosures) => new ClosureAwareRouter(routerFromEnv(clock), closures, clock), inject: [CLOCK, RouteClosures] },
    EtaService,
  ],
  exports: [EtaService, ROUTER, RouteClosures],
})
export class RoutingModule {}
