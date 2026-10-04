import type { SmsMessage as SharedSmsMessage, SmsPort } from '../../../shared/messaging/sms.js';

export type SmsMessage = SharedSmsMessage;

/**
 * Outbound SMS for OTP codes: the shared `SmsPort` (`shared/messaging/sms.ts`). `SMS_PROVIDER`
 * picks `dev` (default), `http` (generic Iraqi gateway) or `twilio` at boot.
 */
export type SmsProvider = SmsPort;

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
