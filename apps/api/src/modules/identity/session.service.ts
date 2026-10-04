import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { ACCESS_TOKEN_TTL_SEC, DriverError, REFRESH_TOKEN_TTL_SEC, SessionClaims, type TokenPair } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityRepository, SessionRecord } from './identity.repository.js';

export interface SessionConfig {
  /** HS256 secret. Rotation: add a new entry, keep the old one until its access tokens expire (15 min). */
  keys: Array<{ kid: string; secret: string }>;
  /** `kid` used to sign new tokens. */
  activeKid: string;
}

/** Minimum length of JWT_SECRET and PHONE_HASH_PEPPER in production. */
export const MIN_SECRET_LENGTH = 32;
const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me-32chars';
const DEV_PHONE_PEPPER = 'dev-only-pepper';
/** Values shipped in code or `.env.example`: never acceptable in production. */
const KNOWN_PLACEHOLDERS = new Set([DEV_JWT_SECRET, DEV_PHONE_PEPPER, 'change-me-in-production-please-32-chars-min', 'change-me-too-and-never-again']);

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] === 'production';
}

/** In production a secret must be set, at least 32 characters, and not a published placeholder. */
function requireProductionSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when NODE_ENV=production; refusing to boot`);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters when NODE_ENV=production; refusing to boot`);
  if (KNOWN_PLACEHOLDERS.has(value)) throw new Error(`${name} is a published placeholder value; refusing to boot`);
  return value;
}

/**
 * JWT keys from JWT_SECRET/JWT_KID. Outside production a missing secret falls back to a dev-only
 * value so a laptop boots with no `.env`; with NODE_ENV=production the API refuses to boot instead
 * (review H: a fallback secret is a public secret, and anyone holding it can mint tokens).
 */
export function sessionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SessionConfig {
  const secret = isProduction(env) ? requireProductionSecret(env, 'JWT_SECRET') : (env['JWT_SECRET'] || DEV_JWT_SECRET);
  const kid = env['JWT_KID'] ?? 'k1';
  return { keys: [{ kid, secret }], activeKid: kid };
}

/**
 * Pepper for phone hashes. Production requires its own PHONE_HASH_PEPPER (no fallback to
 * JWT_SECRET: rotating the JWT key must never orphan every person). Dev falls back as before.
 */
export function phonePepperFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (isProduction(env)) return requireProductionSecret(env, 'PHONE_HASH_PEPPER');
  return env['PHONE_HASH_PEPPER'] || env['JWT_SECRET'] || DEV_PHONE_PEPPER;
}

const ISSUER = 'driver-api';

/**
 * Access tokens: jose HS256 JWT with a `kid` header, 15-minute life, claims {sub, sid, did}.
 * Refresh tokens: 256-bit random, stored as SHA-256 hash, 30-day life, rotated on every use.
 * Reusing an already-rotated refresh token revokes the whole session (token theft signal).
 */
export class SessionService {
  private readonly keys = new Map<string, Uint8Array>();

  constructor(
    private readonly repo: IdentityRepository,
    private readonly clock: Clock,
    private readonly config: SessionConfig,
  ) {
    for (const k of config.keys) this.keys.set(k.kid, new TextEncoder().encode(k.secret));
    if (!this.keys.has(config.activeKid)) throw new Error(`JWT activeKid ${config.activeKid} has no secret`);
  }

  /** Opens a session and returns the token pair; the row is written inside the caller's `tx`. */
  async open(personId: string, deviceId: string | null, tx?: Tx): Promise<{ session: SessionRecord; tokens: TokenPair }> {
    const now = this.clock.now();
    const refresh = newRefreshToken();
    const session = await this.repo.createSession(
      { personId, deviceId, refreshTokenHash: hashToken(refresh), expiresAt: addSec(now, REFRESH_TOKEN_TTL_SEC), now },
      tx,
    );
    const tokens = await this.tokensFor(session, refresh, now);
    return { session, tokens };
  }

  /**
   * Rotating refresh: the presented token is retired and a fresh pair is issued. `patch` may
   * change the session's device (new fingerprint) before the access token is minted.
   */
  async refresh(refreshToken: string, tx?: Tx, patch?: (session: SessionRecord) => Promise<{ deviceId?: string | null } | void>): Promise<{ session: SessionRecord; tokens: TokenPair }> {
    const now = this.clock.now();
    const session = await this.repo.findSessionByRefreshHash(hashToken(refreshToken), tx);
    if (!session) throw new DriverError('token_invalid');
    if (session.revokedAt) throw new DriverError('refresh_reused');
    if (session.expiresAt.getTime() <= now.getTime()) throw new DriverError('session_expired');
    const extra = (await patch?.(session)) ?? {};
    const next = newRefreshToken();
    const updated = await this.repo.updateSession(
      session.id,
      { refreshTokenHash: hashToken(next), rotatedAt: now, expiresAt: addSec(now, REFRESH_TOKEN_TTL_SEC), ...(extra.deviceId !== undefined ? { deviceId: extra.deviceId } : {}) },
      tx,
    );
    const tokens = await this.tokensFor(updated, next, now);
    return { session: updated, tokens };
  }

  async revoke(sessionId: string, tx?: Tx): Promise<void> {
    const s = await this.repo.findSessionById(sessionId, tx);
    if (s && !s.revokedAt) await this.repo.updateSession(sessionId, { revokedAt: this.clock.now() }, tx);
  }

  async revokeByRefreshToken(refreshToken: string, tx?: Tx): Promise<void> {
    const s = await this.repo.findSessionByRefreshHash(hashToken(refreshToken), tx);
    if (s && !s.revokedAt) await this.repo.updateSession(s.id, { revokedAt: this.clock.now() }, tx);
  }

  /**
   * Verifies signature (HS256 only), issuer and expiry (against the injected clock), then that the
   * session named by `sid` exists, belongs to `sub` (and `did`), and is neither revoked nor expired.
   */
  async verifyAccessToken(token: string): Promise<SessionClaims> {
    const now = this.clock.now();
    let payload: unknown;
    try {
      const res = await jwtVerify(
        token,
        (header) => {
          if (header.alg !== 'HS256') throw new DriverError('token_invalid');
          const key = header.kid ? this.keys.get(header.kid) : undefined;
          if (!key) throw new DriverError('token_invalid');
          return key;
        },
        { issuer: ISSUER, algorithms: ['HS256'], currentDate: now },
      );
      payload = res.payload;
    } catch (err) {
      if (err instanceof DriverError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw new DriverError('session_expired', { cause: err });
      throw new DriverError('token_invalid', { cause: err });
    }
    const parsed = SessionClaims.safeParse(payload);
    if (!parsed.success) throw new DriverError('token_invalid');
    const claims = parsed.data;
    await this.assertSessionLive(claims);
    return claims;
  }

  /**
   * The session named by `sid` exists, belongs to `sub` (and `did`), and is neither revoked nor
   * expired. Shared by access-token checks and long-lived streams (`live.*` re-checks it while open).
   */
  async assertSessionLive(claims: Pick<SessionClaims, 'sub' | 'sid' | 'did'>): Promise<void> {
    const now = this.clock.now();
    const session = await this.repo.findSessionById(claims.sid);
    // The session must belong to the subject: a live sid of person A never authenticates a token
    // that claims to be person B (review H), nor a device the session is not bound to.
    if (!session) throw new DriverError('session_expired');
    if (session.personId !== claims.sub) throw new DriverError('token_invalid');
    if (claims.did !== undefined && claims.did !== session.deviceId) throw new DriverError('token_invalid');
    if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) throw new DriverError('session_expired');
  }

  private async tokensFor(session: SessionRecord, refreshToken: string, now: Date): Promise<TokenPair> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SEC;
    const claims: Record<string, unknown> = { sid: session.id };
    if (session.deviceId) claims['did'] = session.deviceId;
    const accessToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', kid: this.config.activeKid })
      .setSubject(session.personId)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.keys.get(this.config.activeKid)!);
    return { accessToken, refreshToken, accessExpiresAt: new Date(exp * 1000), refreshExpiresAt: session.expiresAt };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function addSec(d: Date, sec: number): Date {
  return new Date(d.getTime() + sec * 1000);
}
