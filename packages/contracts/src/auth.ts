import { z } from 'zod';

/** Every grant kind on a Person (domain §1 + Step 1 additions). Mirrors the Prisma `RoleKind` enum. */
export const RoleKind = z.enum([
  'customer',
  'courier',
  'shopper',
  'driver',
  'intercity_driver',
  'khat_driver',
  'merchant_staff',
  'merchant_owner',
  'fleet_owner',
  'guardian',
  'field_ops',
  'dispatcher',
  'support',
  'finance',
  'admin',
]);
export type RoleKind = z.infer<typeof RoleKind>;

/**
 * Roles that freeze until the person re-verifies by OTP (edge-case §7): guardian and every
 * driving role. Wallet withdrawal is not a role; `me.canWithdraw` reports it separately.
 */
export const FREEZABLE_ROLES: readonly RoleKind[] = [
  'guardian',
  'driver',
  'courier',
  'shopper',
  'intercity_driver',
  'khat_driver',
];

/** Roles a declared shared family phone can never hold (edge-case §7). */
export const SHARED_PHONE_FORBIDDEN_ROLES: readonly RoleKind[] = [
  'guardian',
  'driver',
  'courier',
  'shopper',
  'intercity_driver',
  'khat_driver',
];

export const OtpPurpose = z.enum(['login', 'guardian_consent', 'phone_change']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

/** What the access token carries. Roles are looked up live, never trusted from the token. */
export const SessionClaims = z.object({
  /** personId */
  sub: z.string().min(1),
  /** sessionId */
  sid: z.string().min(1),
  /** deviceId, when the session was opened from a registered device */
  did: z.string().optional(),
  iss: z.literal('driver-api'),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionClaims = z.infer<typeof SessionClaims>;

export const RoleGrant = z.object({
  kind: RoleKind,
  orgId: z.string().nullable(),
  frozen: z.boolean(),
});
export type RoleGrant = z.infer<typeof RoleGrant>;

export const DeviceInfo = z.object({
  fingerprint: z.string().min(8).max(200),
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().max(40).optional(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.coerce.date(),
  refreshExpiresAt: z.coerce.date(),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_SEC = 3 * 60;
export const OTP_RESEND_SEC = 30;
export const REVERIFY_AFTER_IDLE_DAYS = 120;
