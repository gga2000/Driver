import { createHmac } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { DriverError, LIVE_RULES, type SessionClaims } from '@driver/contracts';

const ISSUER = 'driver-api-live';
const AUDIENCE = 'driver-live';
const DEV_SECRET = 'dev-only-insecure-secret-change-me-32chars';

/**
 * The signing key of stream tokens: `LIVE_TOKEN_SECRET`, else derived from `JWT_SECRET` (HMAC with a
 * fixed label, so a stream token is never a valid access token even with one shared secret). In
 * production one of them must be set.
 */
export function liveTokenKey(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const own = env['LIVE_TOKEN_SECRET'];
  if (own) return new TextEncoder().encode(own);
  const base = env['JWT_SECRET'] || (env['NODE_ENV'] === 'production' ? null : DEV_SECRET);
  if (!base) throw new Error('LIVE_TOKEN_SECRET or JWT_SECRET must be set in production');
  return new Uint8Array(createHmac('sha256', base).update('driver-live-stream-token').digest());
}

/**
 * Short-lived stream tokens for `live.*` SSE streams (EventSource cannot send an Authorization
 * header): HS256, own issuer and audience, the session's `sub`/`sid`/`did`, and an expiry that is
 * the earlier of `streamTokenTtlSec` and the access token it was minted with — the stream ends
 * when it expires and the client reconnects with a fresh one.
 */
export class StreamTokens {
  constructor(
    private readonly key: Uint8Array,
    private readonly now: () => Date,
  ) {}

  async issue(
    claims: Pick<SessionClaims, 'sub' | 'sid' | 'did' | 'exp'>,
  ): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(this.now().getTime() / 1000);
    const exp = Math.min(iat + LIVE_RULES.streamTokenTtlSec, claims.exp);
    if (exp <= iat) throw new DriverError('session_expired');
    const token = await new SignJWT(
      claims.did ? { sid: claims.sid, did: claims.did } : { sid: claims.sid },
    )
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Signature, issuer, audience and expiry; the session itself is checked by the caller. */
  async verify(token: string): Promise<SessionClaims> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.now(),
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired)
        throw new DriverError('session_expired', { cause: err });
      throw new DriverError('token_invalid', { cause: err });
    }
    const { sub, sid, did, iat, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    )
      throw new DriverError('token_invalid');
    return { sub, sid, ...(typeof did === 'string' ? { did } : {}), iss: 'driver-api', iat, exp };
  }
}
