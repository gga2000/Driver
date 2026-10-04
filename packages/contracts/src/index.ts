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
export * from './ledger-rules.js';
export * from './ledger-io.js';
export * from './domain-events.js';
export * from './event.js';
export * from './city-config.js';
export * from './aziziyah-zones.js';
export * from './aziziyah-landmarks.js';
export * from './auth.js';
export * from './dispatch-io.js';
export * from './console-io.js';
export * from './routes-io.js';
export * from './deals.js';
export * from './catalog-io.js';
export * from './search.js';
export * from './tracking.js';
export * from './account-io.js';
export * from './driver-account-io.js';
export * from './khat-io.js';
export * from './fleet-io.js';
export * from './ops-io.js';
export * from './merchant-admin-io.js';
export * from './partner-io.js';
export * from './merchant-io.js';
export * from './store-hours.js';
export * from './topup-io.js';
export * from './chat-io.js';
export * from './share-io.js';
export * from './live-io.js';
export * from './notify-io.js';
export * from './control-room-io.js';
export * from './support-io.js';
export * from './errors.js';
export { transformer } from './transformer.js';
export { HealthPing, DependencyStatus, CityConfigInput } from './router-io.js';
export type { AppRouter, AppContext, IdentityPort, Actor } from './router.js';
export {
  MeView,
  GuardianLinkView,
  OtpChannel,
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
  RegisterChildInput,
  RegisterChildOutput,
  ChildView,
  UpdateProfileInput,
} from './identity-io.js';
export type { RequestOrigin } from './identity-io.js';
