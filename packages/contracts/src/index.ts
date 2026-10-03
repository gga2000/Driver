/**
 * Client-safe entry: zod schemas, TS types and the wire transformer.
 * The runtime router (which depends on @trpc/server) lives at `@driver/contracts/router`
 * so browser and native bundles never pull server code.
 */
export * from './common.js';
export * from './place.js';
export * from './pricing.js';
export * from './trip.js';
export * from './order.js';
export * from './participant.js';
export * from './ledger.js';
export * from './event.js';
export * from './city-config.js';
export * from './aziziyah-zones.js';
export * from './auth.js';
export * from './dispatch-io.js';
export * from './errors.js';
export { transformer } from './transformer.js';
export { HealthPing, DependencyStatus, CityConfigInput } from './router-io.js';
export type { AppRouter, AppContext, IdentityPort, Actor } from './router.js';
export {
  MeView,
  GuardianLinkView,
  RequestOtpInput,
  RequestOtpOutput,
  VerifyOtpInput,
  VerifyOtpOutput,
  GrantRoleInput,
  RevokeRoleInput,
  LinkGuardianInput,
  ConsentGuardianLinkInput,
  RevokeGuardianLinkInput,
  ChangePhoneStartInput,
  ChangePhoneStartOutput,
  ChangePhoneConfirmInput,
  DevLastOtpOutput,
} from './identity-io.js';
