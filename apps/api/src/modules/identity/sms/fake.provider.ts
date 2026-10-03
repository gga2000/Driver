import { Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider } from './provider.js';

/**
 * Records every send and prints OTP codes to the API terminal (plan Step 2 acceptance:
 * "Console login with fake OTP printed in the API terminal"). `lastCodeFor` backs the dev-only
 * `identity.devLastOtp` procedure and the tests.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly sent: SmsMessage[] = [];
  private readonly logger = new Logger('FakeSms');

  constructor(private readonly log: boolean = true) {}

  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
    if (this.log) this.logger.log(`→ ${message.to}: ${message.body}`);
  }

  lastCodeFor(phoneE164: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const m = this.sent[i]!;
      if (m.to === phoneE164 && m.code) return m.code;
    }
    return null;
  }

  sentTo(phoneE164: string): SmsMessage[] {
    return this.sent.filter((m) => m.to === phoneE164);
  }
}
