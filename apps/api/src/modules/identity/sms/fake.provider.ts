import { DevSmsProvider } from '../../../shared/messaging/sms.js';

/**
 * The dev SMS provider under its historical name (tests and harnesses construct it): records every
 * send, prints OTP codes to the API terminal, and `lastCodeFor` backs `identity.devLastOtp`.
 */
export class FakeSmsProvider extends DevSmsProvider {
  override readonly name: string = 'fake';
}
