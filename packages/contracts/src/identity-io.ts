import { z } from 'zod';
import { DeviceInfo, OtpPurpose, RoleGrant, RoleKind, TokenPair } from './auth.js';

export const MeView = z.object({
  personId: z.string(),
  name: z.string().nullable(),
  /** Masked phone (`+96477*****12`); the full number never leaves the vault through `me`. */
  phoneMasked: z.string(),
  locale: z.string(),
  trustTier: z.string(),
  sharedFamilyPhone: z.boolean(),
  roles: z.array(RoleGrant),
  /** Edge-case §7: true when guardian/driver roles and wallet withdrawal are frozen until OTP re-verification. */
  reverificationRequired: z.boolean(),
  canWithdraw: z.boolean(),
  lastVerifiedAt: z.coerce.date().nullable(),
  /** Customer spec §10 safety: who we call in an emergency. Lives in the vault; the phone comes back masked. */
  emergencyContact: z.object({ name: z.string(), phoneMasked: z.string() }).nullable().optional(),
});
export type MeView = z.infer<typeof MeView>;

/**
 * Profile edits (customer spec §10). The name and the emergency contact go to the identity vault
 * only; `null` clears the contact. At least one field.
 */
export const UpdateProfileInput = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    emergencyContact: z.object({ name: z.string().trim().min(1).max(60), phone: z.string().min(7).max(20) }).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.emergencyContact !== undefined, { message: 'nothing to update' });
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const GuardianLinkView = z.object({
  id: z.string(),
  guardianId: z.string(),
  wardPersonId: z.string().nullable(),
  wardParticipantId: z.string().nullable(),
  state: z.enum(['pending', 'active', 'revoked']),
  /** Arabic label for the Console / apps: "بانتظار الموافقة" while pending. */
  state_ar: z.string(),
});
export type GuardianLinkView = z.infer<typeof GuardianLinkView>;

export const RequestOtpInput = z.object({
  phone: z.string().min(7).max(20),
  purpose: OtpPurpose.default('login'),
  /** The requesting app's device: OTP requests are rate-limited per device (and per IP) — `rate_limited`. */
  device: DeviceInfo.optional(),
});
/** Where a public request came from, as the transport saw it (client IP for per-IP rate limits). */
export type RequestOrigin = { ip?: string | null | undefined };
export const RequestOtpOutput = z.object({
  phoneMasked: z.string(),
  expiresAt: z.coerce.date(),
  resendAfterSec: z.number().int(),
});

export const VerifyOtpInput = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{6}$/),
  device: DeviceInfo.optional(),
  /** Edge-case §7: declared at onboarding; such a person can never hold guardian or driver roles. */
  sharedFamilyPhone: z.boolean().optional(),
});
export const VerifyOtpOutput = z.object({
  personId: z.string(),
  isNew: z.boolean(),
  tokens: TokenPair,
});

/** `device` lets a client report its fingerprint on refresh; an unknown one triggers re-verification (edge-case §7). */
export const RefreshInput = z.object({ refreshToken: z.string().min(16), device: DeviceInfo.optional() });
export const LogoutInput = z.object({ refreshToken: z.string().min(16).optional() });

export const GrantRoleInput = z.object({ personId: z.string(), kind: RoleKind, orgId: z.string().optional() });
export const RevokeRoleInput = GrantRoleInput;

export const LinkGuardianInput = z.object({
  wardPhone: z.string().min(7).max(20).optional(),
  wardParticipantId: z.string().optional(),
}).refine((v) => Boolean(v.wardPhone) !== Boolean(v.wardParticipantId), { message: 'exactly one of wardPhone or wardParticipantId' });

export const ConsentGuardianLinkInput = z.object({ linkId: z.string(), code: z.string().regex(/^\d{6}$/) });
export const RevokeGuardianLinkInput = z.object({ linkId: z.string() });

export const ChangePhoneStartInput = z.object({ newPhone: z.string().min(7).max(20) });
export const ChangePhoneStartOutput = z.object({ oldPhoneMasked: z.string(), newPhoneMasked: z.string(), expiresAt: z.coerce.date() });
export const ChangePhoneConfirmInput = z.object({ oldCode: z.string().regex(/^\d{6}$/), newCode: z.string().regex(/^\d{6}$/) });

/**
 * خطوط children (M2 review follow-up): a guardian registers a child's name into the identity vault and
 * gets an opaque `childRef` back; stops and events carry only that ref. Names are read back only
 * through the identity module (driver run sheet, guardian view), every read logged.
 */
export const RegisterChildInput = z.object({ name: z.string().trim().min(1).max(80) });
export const RegisterChildOutput = z.object({ childRef: z.string() });
export const ChildView = z.object({ childRef: z.string(), name: z.string() });
export type ChildView = z.infer<typeof ChildView>;

export const DevLastOtpInput = z.object({ phone: z.string().min(7).max(20) });
export const DevLastOtpOutput = z.object({ phoneMasked: z.string(), code: z.string().nullable() });

export type Actor = { personId: string; sessionId: string; deviceId?: string };

/** What the identity module exposes to the transport. Implemented by apps/api, consumed by the router. */
export interface IdentityPort {
  requestOtp(input: z.infer<typeof RequestOtpInput>, origin?: RequestOrigin): Promise<z.infer<typeof RequestOtpOutput>>;
  verifyOtp(input: z.infer<typeof VerifyOtpInput>): Promise<z.infer<typeof VerifyOtpOutput>>;
  refresh(refreshToken: string, device?: DeviceInfo): Promise<TokenPair>;
  logout(actor: Actor, refreshToken?: string): Promise<void>;
  me(actor: Actor): Promise<MeView>;
  updateProfile(actor: Actor, input: UpdateProfileInput): Promise<MeView>;
  hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean>;
  grantRole(actor: Actor, input: z.infer<typeof GrantRoleInput>): Promise<RoleGrant>;
  revokeRole(actor: Actor, input: z.infer<typeof RevokeRoleInput>): Promise<void>;
  linkGuardian(actor: Actor, input: z.infer<typeof LinkGuardianInput>): Promise<GuardianLinkView>;
  consentGuardianLink(actor: Actor, input: z.infer<typeof ConsentGuardianLinkInput>): Promise<GuardianLinkView>;
  revokeGuardianLink(actor: Actor, input: z.infer<typeof RevokeGuardianLinkInput>): Promise<GuardianLinkView>;
  changePhoneStart(actor: Actor, input: z.infer<typeof ChangePhoneStartInput>): Promise<z.infer<typeof ChangePhoneStartOutput>>;
  changePhoneConfirm(actor: Actor, input: z.infer<typeof ChangePhoneConfirmInput>): Promise<MeView>;
  devLastOtp(phone: string): Promise<z.infer<typeof DevLastOtpOutput>>;
  registerChild(actor: Actor, input: z.infer<typeof RegisterChildInput>): Promise<z.infer<typeof RegisterChildOutput>>;
  /** The guardian's own children with their names (each read logged in the vault access log). */
  myChildren(actor: Actor): Promise<ChildView[]>;
}

