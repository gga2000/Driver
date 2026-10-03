import { DriverError } from '@driver/contracts';
import type { SmsMessage, SmsProvider } from './provider.js';

/**
 * Real SMS gateway (Iraqi aggregator; vendor chosen in Milestone 3). Until credentials and the
 * HTTP client land this provider refuses to send so a misconfigured production box fails loudly
 * instead of silently dropping codes.
 */
export class GatewaySmsProvider implements SmsProvider {
  readonly name = 'gateway';

  constructor(private readonly config: { url?: string; apiKey?: string } = {}) {}

  async send(_message: SmsMessage): Promise<void> {
    if (!this.config.url || !this.config.apiKey) throw new DriverError('sms_not_configured', { cause: new Error('gateway not configured') });
    // TODO(M3): POST to the aggregator; map vendor errors to DriverError codes.
    throw new DriverError('sms_not_configured', { cause: new Error('gateway not configured') });
  }
}

/** Picks the provider from SMS_PROVIDER (default `fake`). */
export function smsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): 'fake' | 'gateway' {
  return env['SMS_PROVIDER'] === 'gateway' ? 'gateway' : 'fake';
}
