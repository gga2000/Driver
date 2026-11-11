import { randomBytes } from 'node:crypto';

/** Minimum length of every signing secret in production. */
export const MIN_SECRET_LENGTH = 32;

/** Values shipped in code or `.env.example`: never acceptable in production. */
export const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'dev-only-insecure-secret-change-me-32chars',
  'dev-only-pepper',
  'change-me-in-production-please-32-chars-min',
  'change-me-too-and-never-again',
]);

export function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] === 'production';
}

/** In production a secret must be set, at least 32 characters, and not a published placeholder. */
export function requireProductionSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when NODE_ENV=production; refusing to boot`);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters when NODE_ENV=production; refusing to boot`);
  if (KNOWN_PLACEHOLDERS.has(value)) throw new Error(`${name} is a published placeholder value; refusing to boot`);
  return value;
}

/**
 * SEC-15: the secret that signs a kind of public link (share-trip, SOS). In production it must be its
 * own value: required, strong, and different from JWT_SECRET and from the other link secrets named in
 * `distinctFrom`, so the routine JWT rotation (or another link kind's) never kills links people already
 * sent. Outside production it falls back (`fallbacks` in order, then a random value per boot) so a
 * laptop needs no `.env`.
 */
export function linkSecretFromEnv(env: NodeJS.ProcessEnv, name: string, opts: { fallbacks?: readonly string[]; distinctFrom?: readonly string[] } = {}): string {
  if (isProduction(env)) {
    const value = requireProductionSecret(env, name);
    for (const other of ['JWT_SECRET', ...(opts.distinctFrom ?? [])]) {
      if (value === env[other]) throw new Error(`${name} must differ from ${other} (rotating one would break the other's links); refusing to boot`);
    }
    return value;
  }
  for (const key of [name, ...(opts.fallbacks ?? [])]) if (env[key]) return env[key]!;
  return randomBytes(32).toString('hex');
}

/**
 * STAFF_TOTP_KEY (docs/api/staff-totp.md): the AES-256-GCM key that seals admin and finance
 * authenticator secrets, 64 hex characters (`openssl rand -hex 32`), its own value. Null when it is
 * fine; otherwise what is wrong (the boot check lists it, identity refuses to start without it).
 */
export function staffTotpKeyProblem(env: NodeJS.ProcessEnv): string | null {
  const raw = env['STAFF_TOTP_KEY']?.trim() ?? '';
  if (!raw) return 'STAFF_TOTP_KEY is not set: admin and finance cannot pass the authenticator step (64 hex characters, openssl rand -hex 32)';
  if (!/^[0-9a-f]{64}$/i.test(raw)) return 'STAFF_TOTP_KEY must be 64 hex characters (openssl rand -hex 32)';
  for (const other of ['JWT_SECRET', 'PHONE_HASH_PEPPER', 'UPLOADS_SECRET', 'SHARE_LINK_SECRET', 'SAFETY_LINK_SECRET']) {
    if (env[other]?.trim() === raw) return `STAFF_TOTP_KEY must be its own value, not the same as ${other}`;
  }
  return null;
}
