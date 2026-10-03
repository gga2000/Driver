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

export function sessionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SessionConfig {
  const secret = env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-me-32chars';
  const kid = env['JWT_KID'] ?? 'k1';
  return { keys: [{ kid, secret }], activeKid: kid };
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

  /** Verifies signature, issuer and expiry (against the injected clock) and that the session is still live. */
  async verifyAccessToken(token: string): Promise<SessionClaims> {
    const now = this.clock.now();
    let payload: unknown;
    try {
      const res = await jwtVerify(
        token,
        (header) => {
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
    const session = await this.repo.findSessionById(parsed.data.sid);
    if (!session || session.revokedAt) throw new DriverError('session_expired');
    return parsed.data;
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
