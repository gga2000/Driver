export interface SmsMessage {
  /** E.164 destination. */
  to: string;
  /** Arabic body, e.g. "رمز درايفر: 123456". */
  body: string;
  /** The OTP code when the message carries one, so dev tooling can surface it without parsing. */
  code?: string;
}

/** Outbound SMS. `SMS_PROVIDER=fake|gateway` picks the implementation at boot. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
