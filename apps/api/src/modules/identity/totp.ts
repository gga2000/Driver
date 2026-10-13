import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { STAFF_TOTP_RULES } from '@driver/contracts';
import { isProduction, staffTotpKeyProblem } from '../../shared/secrets.js';

/**
 * The staff authenticator's pieces (docs/api/staff-totp.md), with no state: RFC 6238 codes (HMAC-SHA1,
 * 6 digits, 30-second steps), the secret's encryption at rest (AES-256-GCM under STAFF_TOTP_KEY, bound
 * to the person), and recovery codes kept as salted scrypt hashes.
 */

export interface StaffTotpConfig {
  /** 32 bytes: the AES-256-GCM key for secrets at rest. */
  key: Buffer;
  /** Demo mode: `identity.authenticator.demoCode` hands out the caller's current code (never on a deployed server). */
  demo: boolean;
}

const DEV_KEY_SEED = 'dev-only-staff-totp-key';

/**
 * STAFF_TOTP_KEY: 64 hex characters (32 random bytes, `openssl rand -hex 32`), its own value, never shared
 * with another secret. Staging and production refuse to boot without it; a laptop falls back to a fixed
 * dev key so it needs no `.env`. STAFF_TOTP_DEMO=1 turns on the demo code (the Console demo API sets
 * it); on a deployed server it stops the boot, like the dev push provider does on a live host (OPS-02).
 */
export function staffTotpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StaffTotpConfig {
  const raw = env['STAFF_TOTP_KEY']?.trim() ?? '';
  const demoAsked = ['1', 'on', 'true'].includes((env['STAFF_TOTP_DEMO'] ?? '').trim().toLowerCase());
  if (isProduction(env)) {
    if (demoAsked) throw new Error('STAFF_TOTP_DEMO is for the local demo only: a deployed server never hands out authenticator codes; refusing to boot');
    const problem = staffTotpKeyProblem(env);
    if (problem) throw new Error(`${problem}; refusing to boot`);
    return { key: Buffer.from(raw, 'hex'), demo: false };
  }
  const key = staffTotpKeyProblem(env) === null ? Buffer.from(raw, 'hex') : createHash('sha256').update(DEV_KEY_SEED).digest();
  return { key, demo: demoAsked };
}

// ───────────────────────── codes (RFC 6238 / 4226) ─────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, RFC 4226's recommendation), base32 for the app. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / STAFF_TOTP_RULES.stepSec);
}

/** The 6-digit code of `step` for a base32 secret (HMAC-SHA1, dynamic truncation). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** STAFF_TOTP_RULES.digits).padStart(STAFF_TOTP_RULES.digits, '0');
}

/**
 * The step `code` belongs to within one step either side of `at`, newer than `lastStep` (a code is
 * never accepted twice); null when it matches none. Every candidate is compared, in constant time.
 */
export function matchTotp(secret: string, code: string, at: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  let found: number | null = null;
  for (let s = now - STAFF_TOTP_RULES.window; s <= now + STAFF_TOTP_RULES.window; s += 1) {
    const same = timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(code));
    if (same && (lastStep === null || s > lastStep) && found === null) found = s;
  }
  return found;
}

/** The app's set-up link (the QR code holds it): issuer "Driver", SHA-1, 6 digits, 30 seconds. */
export function otpauthUri(secret: string, account: string): string {
  const label = `Driver:${account}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=Driver&algorithm=SHA1&digits=${STAFF_TOTP_RULES.digits}&period=${STAFF_TOTP_RULES.stepSec}`;
}

// ───────────────────────── secret at rest ─────────────────────────

const aad = (personId: string) => Buffer.from(`staff-totp:${personId}`);

/** `v1.<iv>.<tag>.<ciphertext>` (base64url): AES-256-GCM, a fresh 12-byte IV, bound to the person. */
export function sealSecret(key: Buffer, personId: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(personId));
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Opens a sealed secret; throws when the key, the person or the bytes do not match. */
export function openSecret(key: Buffer, personId: string, sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('staff totp secret: unknown format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(aad(personId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

// ───────────────────────── recovery codes ─────────────────────────

/** No 0/O, 1/I/L: read off paper without doubt. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

/** `XXXXX-XXXXX`: 10 characters of a 31-letter alphabet (about 49 bits each). */
export function newRecoveryCodes(count: number = STAFF_TOTP_RULES.recoveryCodes): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** What a typed recovery code is compared as: letters and digits only, upper case. */
export function normalizeRecoveryCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** `s1$<salt>$<hash>`: scrypt with a fresh 16-byte salt per code. */
export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeRecoveryCode(code), salt, 32, SCRYPT);
  return `s1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** The stored hash `code` matches, if any (each compared in constant time). */
export function findRecoveryHash(code: string, hashes: readonly string[]): string | null {
  const given = normalizeRecoveryCode(code);
  if (given.length !== 10) return null;
  let found: string | null = null;
  for (const stored of hashes) {
    const [v, salt, hash] = stored.split('$');
    if (v !== 's1' || !salt || !hash) continue;
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(given, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
    if (timingSafeEqual(expected, actual) && found === null) found = stored;
  }
  return found;
}
