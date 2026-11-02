import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { ClosureAwareRouter } from './closure-aware.router.js';
import { RouteClosures } from './closures.js';
import { EtaService, STREET_SHAPES } from './eta.service.js';
import { OSRM_DEFAULT_TIMEOUT_MS, OsrmRouter } from './osrm.router.js';
import { ResilientRouter } from './resilient.router.js';
import { ROUTER, type Router } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';
import { TOWN_SHAPES } from './street-shapes.js';

/**
 * Routers from the environment: `OSRM_URL` (e.g. http://driver-osrm.internal:5000) turns on road routing.
 * Without it the route lines still follow our map's streets (`EtaService.path` with StreetShapes).
 */
export function routerFromEnv(clock: Clock, env: NodeJS.ProcessEnv = process.env): Router {
  const url = env['OSRM_URL'];
  if (!url) return new StraightLineRouter();
  const timeout = Number(env['OSRM_TIMEOUT_MS'] ?? OSRM_DEFAULT_TIMEOUT_MS);
  return new ResilientRouter(new OsrmRouter(url, Number.isFinite(timeout) && timeout > 0 ? timeout : OSRM_DEFAULT_TIMEOUT_MS), new StraightLineRouter(), clock);
}

/** Road routing and the one ETA service (maps program SP4b); every route goes around today's closed streets (N20). */
@Module({
  providers: [
    RouteClosures,
    { provide: ROUTER, useFactory: (clock: Clock, closures: RouteClosures) => new ClosureAwareRouter(routerFromEnv(clock), closures, clock), inject: [CLOCK, RouteClosures] },
    // Ali 2026-11-01: route lines follow our map's streets when there is no OSRM road shape.
    { provide: STREET_SHAPES, useValue: TOWN_SHAPES },
    EtaService,
  ],
  exports: [EtaService, ROUTER, RouteClosures],
})
export class RoutingModule {}
