import { initTRPC, TRPCError } from '@trpc/server';
import type { RoleKind, SessionClaims } from './auth.js';
import type { Actor, IdentityPort } from './identity-io.js';
export type { Actor, IdentityPort } from './identity-io.js';
import type { CityPricingConfig } from './city-config.js';
import type { ConsolePort } from './console-io.js';
import type { DispatchPort } from './dispatch-io.js';
import type { LedgerPort } from './ledger-io.js';
import { DriverError, errorEnvelope, isDriverError, type ErrorCode } from './errors.js';
import type { OrdersPort } from './order.js';
import type { PriceRequest, Quote } from './pricing.js';
import type { TripsPort } from './trip.js';
import type { DependencyStatus } from './router-io.js';
import { transformer } from './transformer.js';

// ───────────────────────── context ─────────────────────────

/**
 * The router lives here so every client shares one `AppRouter` type without importing API
 * internals. The API supplies the implementation through `AppContext`.
 */
export interface AppContext {
  pricing: { quote(req: PriceRequest): Quote };
  config: { city(cityId: string): CityPricingConfig | undefined };
  health: { db(): Promise<DependencyStatus>; redis(): Promise<DependencyStatus> };
  identity: IdentityPort;
  orders: OrdersPort;
  trips: TripsPort;
  dispatch: DispatchPort;
  ledger: LedgerPort;
  /** Console read side: cross-module views composed by the API's `console` module. */
  console: ConsolePort;
  /** Verified claims of the `Authorization: Bearer` token on this request, if any. */
  auth: SessionClaims | null;
  /** Why `auth` is null when a token was presented (expired, malformed…); null when no token. */
  authError: ErrorCode | null;
  /** The caller as the transport saw it (client IP behind the configured proxy); absent in tests. */
  client?: { ip: string | null };
  env: { nodeEnv: string };
  now(): Date;
  version: string;
}

/** Converts a thrown DriverError into a TRPCError whose `data` carries the envelope. */
export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (isDriverError(err)) {
    return new TRPCError({ code: err.status, message: err.envelope.message_en, cause: err });
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'internal', cause: err });
}

export const t = initTRPC.context<AppContext>().create({
  transformer,
  // Spec §12: clients never see stack traces; every error carries {code, message_ar, retryHint}.
  errorFormatter({ shape, error }) {
    const data = { ...shape.data } as Record<string, unknown>;
    delete data['stack'];
    const cause = error.cause;
    let envelope;
    if (isDriverError(cause)) envelope = cause.envelope;
    else if (error.code === 'UNAUTHORIZED') envelope = errorEnvelope('unauthorized');
    else if (error.code === 'FORBIDDEN') envelope = errorEnvelope('forbidden');
    else if (error.code === 'NOT_FOUND') envelope = errorEnvelope('not_found');
    else if (error.code === 'BAD_REQUEST') envelope = errorEnvelope('invalid_input');
    else envelope = errorEnvelope('internal');
    return { ...shape, message: envelope.message_ar, data: { ...data, ...envelope } };
  },
});

export const router = t.router;

/**
 * Maps a DriverError thrown anywhere below to its tRPC code (and so its HTTP status: offer_taken →
 * 409, dev_only → 403…). tRPC v11 does not throw out of `next()`: a failing resolver or middleware
 * comes back as `{ ok: false, error }` with the DriverError wrapped as INTERNAL_SERVER_ERROR's
 * `cause`, so the result is inspected, not caught. Throwing here is turned back into a result by
 * tRPC with the new code.
 */
export const publicProcedure = t.procedure.use(async ({ next }) => {
  let result;
  try {
    result = await next();
  } catch (err) {
    throw toTrpcError(err);
  }
  if (!result.ok && result.error.code === 'INTERNAL_SERVER_ERROR' && isDriverError(result.error.cause)) throw toTrpcError(result.error.cause);
  return result;
});

/**
 * Requires a valid access token; with `roles`, requires at least one of them (live lookup, so a
 * revoked or frozen role takes effect on the next request, not at token expiry).
 */
export function protectedProcedure(roles?: readonly RoleKind[]) {
  return publicProcedure.use(async ({ ctx, next }) => {
    if (!ctx.auth) throw toTrpcError(new DriverError(ctx.authError ?? 'unauthorized'));
    const actor: Actor = { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) };
    if (roles && roles.length > 0) {
      let allowed = false;
      for (const kind of roles) {
        if (await ctx.identity.hasRole(actor.personId, kind)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) throw toTrpcError(new DriverError('forbidden'));
    }
    return next({ ctx: { ...ctx, actor } });
  });
}
