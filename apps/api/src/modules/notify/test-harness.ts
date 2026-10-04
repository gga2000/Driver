import type { Locale } from '@driver/i18n';
import { FakeClock } from '../../shared/clock.js';
import { ProviderError } from '../../shared/messaging/http.js';
import { DevSmsProvider } from '../../shared/messaging/sms.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { NotifyEngine, type NotifyJob } from './notify.engine.js';
import { InMemoryNotifyRepository } from './notify.repository.js';
import { NotifyService } from './notify.service.js';
import { DevPushProvider, type PushMessage, type PushPort, type PushReceipt, type PushTicket } from './providers/push.js';
import { DevWhatsAppProvider, type WhatsAppMessage, type WhatsAppPort, type WhatsAppResult } from './providers/whatsapp.js';

/** A push port whose tickets and receipts a test scripts. */
export class ScriptedPush implements PushPort {
  readonly name = 'scripted';
  readonly sent: PushMessage[] = [];
  /** Thrown by the next sends, in order (a transient provider outage). */
  readonly throwNext: ProviderError[] = [];
  /** Per-token ticket override. */
  readonly ticket = new Map<string, Omit<PushTicket, 'token'>>();
  /** Receipt per ticket id; absent = not yet available. */
  readonly receipt = new Map<string, Omit<PushReceipt, 'id'>>();
  receiptsAsked: string[][] = [];
  private seq = 0;

  constructor(readonly hasReceipts = true) {}

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const err = this.throwNext.shift();
    if (err) throw err;
    return messages.map((m) => {
      this.sent.push(m);
      const forced = this.ticket.get(m.token);
      if (forced) return { token: m.token, ...forced };
      this.seq += 1;
      return { token: m.token, ok: true, id: `t${this.seq}` };
    });
  }

  async receipts(ids: readonly string[]): Promise<PushReceipt[]> {
    this.receiptsAsked.push([...ids]);
    return ids.flatMap((id) => {
      const r = this.receipt.get(id);
      return r ? [{ id, ...r }] : [];
    });
  }
}

/** WhatsApp with status callbacks on (the webhook decides delivery). */
export class CallbackWhatsApp implements WhatsAppPort {
  readonly name = 'meta-test';
  readonly statusCallbacks = true;
  readonly sent: WhatsAppMessage[] = [];
  private seq = 0;

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    this.sent.push(message);
    this.seq += 1;
    return { provider: this.name, messageId: `wamid.${this.seq}` };
  }
}

export const PHONES: Record<string, string> = { cust: '+9647701110001', guardian: '+9647701110002', owner: '+9647701110003', courier: '+9647701110004' };

/** 12:00 Baghdad. */
export const NOON = '2026-10-04T09:00:00Z';

export function notifyHarness(opts: { push?: PushPort; whatsapp?: WhatsAppPort; start?: string; locale?: Record<string, Locale> } = {}) {
  const clock = new FakeClock(opts.start ?? NOON);
  const repo = new InMemoryNotifyRepository();
  const queue = new InMemoryQueue<NotifyJob>('notify', () => clock.now());
  const push = opts.push ?? new DevPushProvider(false);
  const sms = new DevSmsProvider(false);
  const whatsapp = opts.whatsapp ?? new DevWhatsAppProvider(false);
  const phoneReads: string[] = [];
  const contacts = {
    contact: async (personId: string, o: { phone: boolean; purpose: string }) => {
      if (o.phone) phoneReads.push(`${personId}:${o.purpose}`);
      return { locale: opts.locale?.[personId] ?? ('ar-IQ' as Locale), phoneE164: o.phone ? (PHONES[personId] ?? null) : null };
    },
  };
  const engine = new NotifyEngine(repo, { push: { expo: push, fcm: push }, sms, whatsapp }, contacts, queue, clock, { retryBaseMs: 1000, maxAttempts: 3, receiptDelaySec: 60 });
  queue.process((job) => engine.process(job.data));
  const service = new NotifyService(undefined, engine, repo, clock);
  /** Advance the clock and run every job due. */
  const run = async (ms = 0) => {
    if (ms > 0) clock.advance(ms);
    await queue.drain();
  };
  const rows = async (filter: { personId?: string; orderId?: string } = {}) => (await repo.log({ ...filter, limit: 200 })).reverse();
  const actor = (personId: string, sessionId = `s-${personId}`) => ({ personId, sessionId });
  const register = (personId: string, token = `ExponentPushToken[${personId}-1]`, app: 'customer' | 'partner' | 'merchant' = 'customer', sessionId?: string) =>
    service.registerDevice(actor(personId, sessionId), { token, kind: 'expo', app, platform: 'android' });
  return { clock, repo, queue, push, sms, whatsapp, engine, service, run, rows, actor, register, phoneReads };
}
