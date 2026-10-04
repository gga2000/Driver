import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { globalFetch, parseJson, pick, ProviderError, send, transientStatus, type FetchLike } from '../../../shared/messaging/http.js';

export interface WhatsAppMessage {
  /** E.164 destination. */
  to: string;
  /** Approved template name (`order_receipt`). */
  template: string;
  /** Meta language code: `ar` or `en`. */
  language: 'ar' | 'en';
  /** Body parameters in `{{1}}…{{n}}` order. */
  params: readonly string[];
  /** The rendered text, for the dev log only (never sent to Meta). */
  preview?: string;
}

export interface WhatsAppResult {
  provider: string;
  messageId: string | null;
}

/**
 * WhatsApp Business. `statusCallbacks`: delivery / read statuses arrive on the webhook, so an
 * accepted message is only "delivered" once Meta says so (the SMS-twin rule waits for it). Without
 * a webhook an accepted message counts as delivered.
 */
export interface WhatsAppPort {
  readonly name: string;
  readonly statusCallbacks: boolean;
  send(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

// ───────────────────────── dev ─────────────────────────

export class DevWhatsAppProvider implements WhatsAppPort {
  readonly name = 'dev';
  readonly statusCallbacks = false;
  readonly sent: WhatsAppMessage[] = [];
  private readonly logger = new Logger('DevWhatsApp');
  private seq = 0;

  constructor(private readonly log = true) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    this.sent.push(message);
    if (this.log) this.logger.log(`→ ${message.to} [${message.template}/${message.language}] ${message.preview ?? message.params.join(' | ')}`);
    this.seq += 1;
    return { provider: this.name, messageId: `dev-wamid-${this.seq}` };
  }
}

// ───────────────────────── Cloud API ─────────────────────────

export interface WhatsAppCloudConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  baseUrl: string;
  /** True when the status webhook is set up (WHATSAPP_APP_SECRET). */
  statusCallbacks: boolean;
}

/** Meta error codes that retrying cannot fix. */
const PERMANENT = new Set([
  0, // AuthException
  10, // permission denied
  100, // invalid parameter
  190, // access token expired
  131008, // required parameter missing
  131009, // parameter value invalid
  131021, // recipient = sender
  131026, // message undeliverable (not on WhatsApp)
  131030, // recipient not in allowed list (test number)
  131047, // re-engagement window (should not happen with templates)
  131051, // unsupported message type
  132000, // template param count mismatch
  132001, // template does not exist (name / language)
  132005, // translated text too long
  132007, // template format policy
  132012, // param format mismatch
  132015, // template paused
  132016, // template disabled
]);
/** The recipient itself is unreachable on WhatsApp. */
const RECIPIENT = new Set([131026, 131030, 131021]);

/**
 * Meta WhatsApp Cloud API: `POST {graph}/{version}/{phone-number-id}/messages` with a template
 * message (body parameters as text). Rate limits (130429, 131048, 131056, 80007) and 5xx are retried.
 */
export class WhatsAppCloudProvider implements WhatsAppPort {
  readonly name = 'meta';

  constructor(
    private readonly config: WhatsAppCloudConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  get statusCallbacks(): boolean {
    return this.config.statusCallbacks;
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    if (!this.config.token || !this.config.phoneNumberId) throw new ProviderError(this.name, 'not_configured', 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set', true);
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const res = await send(this.name, this.fetchImpl, url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(cloudTemplateBody(message)),
    });
    const json = parseJson(res.body);
    if (res.status >= 200 && res.status < 300) {
      const id = pick(json, 'messages.0.id');
      return { provider: this.name, messageId: typeof id === 'string' ? id : null };
    }
    const code = Number(pick(json, 'error.code'));
    const permanent = PERMANENT.has(code) || (!transientStatus(res.status) && !Number.isFinite(code));
    throw new ProviderError(this.name, Number.isFinite(code) ? `wa_${code}` : `http_${res.status}`, String(pick(json, 'error.message') ?? res.body.slice(0, 200)), permanent, RECIPIENT.has(code));
  }
}

/** The Cloud API request body for a template message. */
export function cloudTemplateBody(message: WhatsAppMessage): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to.replace(/[^\d]/g, ''),
    type: 'template',
    template: {
      name: message.template,
      language: { code: message.language },
      components: message.params.length > 0 ? [{ type: 'body', parameters: message.params.map((text) => ({ type: 'text', text })) }] : [],
    },
  };
}

// ───────────────────────── webhook ─────────────────────────

export type WhatsAppStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsAppStatusUpdate {
  messageId: string;
  status: WhatsAppStatus;
  at: Date;
  error: string | null;
}

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>`. */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Status updates out of a Cloud API webhook payload (`entry[].changes[].value.statuses[]`). */
export function parseStatusWebhook(body: unknown): WhatsAppStatusUpdate[] {
  const out: WhatsAppStatusUpdate[] = [];
  const entries = pick(body, 'entry');
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = pick(entry, 'changes');
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = pick(change, 'value.statuses');
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        const id = pick(s, 'id');
        const status = pick(s, 'status');
        if (typeof id !== 'string' || (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed')) continue;
        const ts = Number(pick(s, 'timestamp'));
        const err = pick(s, 'errors.0');
        out.push({ messageId: id, status, at: Number.isFinite(ts) ? new Date(ts * 1000) : new Date(), error: err ? `wa_${String(pick(err, 'code') ?? '')}: ${String(pick(err, 'title') ?? '')}` : null });
      }
    }
  }
  return out;
}

export function whatsAppPortFromEnv(env: NodeJS.ProcessEnv = process.env, opts: { fetchImpl?: FetchLike; log?: boolean } = {}): WhatsAppPort {
  const choice = (env['WHATSAPP_PROVIDER'] ?? (env['WHATSAPP_TOKEN'] ? 'meta' : 'dev')).toLowerCase();
  if (choice !== 'meta' && choice !== 'cloud') return new DevWhatsAppProvider(opts.log ?? true);
  return new WhatsAppCloudProvider(
    {
      token: env['WHATSAPP_TOKEN'] ?? '',
      phoneNumberId: env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
      apiVersion: env['WHATSAPP_API_VERSION'] ?? 'v21.0',
      baseUrl: env['WHATSAPP_GRAPH_URL'] ?? 'https://graph.facebook.com',
      statusCallbacks: Boolean(env['WHATSAPP_APP_SECRET']),
    },
    opts.fetchImpl,
  );
}
