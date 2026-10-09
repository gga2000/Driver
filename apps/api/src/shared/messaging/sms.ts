import { Logger } from '@nestjs/common';
import { globalFetch, parseJson, pick, ProviderError, send, transientStatus, type FetchLike } from './http.js';

export interface SmsMessage {
  /** E.164 destination (`+9647…`). */
  to: string;
  /** Arabic body, e.g. "رمز دخول درايفر: 123456". */
  body: string;
  /** The OTP code when the message carries one, so dev tooling can surface it without parsing. */
  code?: string;
}

export interface SmsResult {
  provider: string;
  /** The gateway's message id when it returns one. */
  messageId: string | null;
}

/**
 * Outbound SMS for OTP codes (identity) and the SMS twins of critical notifications (notify).
 * `SMS_PROVIDER` picks the implementation at boot: `dev` (default; logs, keeps the codes for
 * `identity.devLastOtp`), `http` (any Iraqi gateway with an HTTP API, configured by env) or `twilio`
 * (Twilio or a Twilio-compatible API). Throws `ProviderError` on failure.
 */
export interface SmsPort {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

// ───────────────────────── dev ─────────────────────────

/**
 * Records every send and prints it to the API terminal (OTP codes included: "Console login with
 * fake OTP printed in the API terminal"). `lastCodeFor` backs the dev-only `identity.devLastOtp`.
 */
export class DevSmsProvider implements SmsPort {
  readonly name: string = 'dev';
  readonly sent: SmsMessage[] = [];
  private readonly logger = new Logger('DevSms');
  private seq = 0;

  constructor(private readonly log: boolean = true) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    this.sent.push(message);
    if (this.log) this.logger.log(`→ ${message.to}: ${message.body}`);
    this.seq += 1;
    return { provider: this.name, messageId: `dev-sms-${this.seq}` };
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

// ───────────────────────── generic HTTP gateway ─────────────────────────

export type SmsNumberFormat = 'e164' | 'digits' | 'local';

export interface HttpSmsConfig {
  /** URL template; `{to}`, `{text}`, `{sender}` are URL-encoded into it (GET gateways put everything here). */
  url: string;
  method: 'GET' | 'POST';
  /** Body template for POST; placeholders are JSON-escaped for a JSON content type, URL-encoded otherwise. */
  body?: string | undefined;
  contentType: string;
  /** Full header line, e.g. `Authorization: Bearer xyz` or `X-API-Key: xyz`. */
  authHeader?: string | undefined;
  senderId?: string | undefined;
  /** How the gateway wants the number: `+9647701234567`, `9647701234567` or `07701234567`. */
  numberFormat: SmsNumberFormat;
  /** When set, a 2xx answer whose body does not match is a (retryable) failure. */
  successPattern?: RegExp | undefined;
  /** Dotted path of the message id in a JSON answer (`data.id`). */
  idPath?: string | undefined;
}

export function formatNumber(e164: string, format: SmsNumberFormat): string {
  const digits = e164.replace(/[^\d]/g, '');
  if (format === 'digits') return digits;
  if (format === 'local') return digits.startsWith('964') ? `0${digits.slice(3)}` : digits;
  return `+${digits}`;
}

function fill(template: string, values: Record<string, string>, encode: (v: string) => string): string {
  return template.replace(/\{(to|text|sender)\}/g, (_, k: string) => encode(values[k] ?? ''));
}

const jsonEscape = (v: string) => JSON.stringify(v).slice(1, -1);

/**
 * Any HTTP SMS gateway (Iraqi aggregators such as those behind Zain / Asiacell / Korek sender ids):
 * the URL, method, body, auth header and number format all come from env, so switching vendor is
 * configuration. 2xx = accepted; 408/429/5xx and network errors are retried; other 4xx are not.
 */
export class HttpSmsProvider implements SmsPort {
  readonly name = 'http';

  constructor(
    private readonly config: HttpSmsConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.config.url) throw new ProviderError(this.name, 'not_configured', 'SMS_HTTP_URL is not set', true);
    const values = { to: formatNumber(message.to, this.config.numberFormat), text: message.body, sender: this.config.senderId ?? '' };
    const url = fill(this.config.url, values, encodeURIComponent);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.config.authHeader) {
      const i = this.config.authHeader.indexOf(':');
      if (i > 0) headers[this.config.authHeader.slice(0, i).trim()] = this.config.authHeader.slice(i + 1).trim();
    }
    let body: string | undefined;
    if (this.config.method === 'POST') {
      const json = this.config.contentType.includes('json');
      const template = this.config.body ?? (json ? '{"to":"{to}","text":"{text}","sender":"{sender}"}' : 'to={to}&text={text}&sender={sender}');
      body = fill(template, values, json ? jsonEscape : encodeURIComponent);
      headers['content-type'] = this.config.contentType;
    }
    const res = await send(this.name, this.fetchImpl, url, { method: this.config.method, headers, ...(body !== undefined ? { body } : {}) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError(this.name, `http_${res.status}`, res.body.slice(0, 200), !transientStatus(res.status));
    if (this.config.successPattern && !this.config.successPattern.test(res.body)) throw new ProviderError(this.name, 'rejected', res.body.slice(0, 200), false);
    const id = this.config.idPath ? pick(parseJson(res.body), this.config.idPath) : undefined;
    return { provider: this.name, messageId: id === undefined || id === null ? null : String(id) };
  }
}

// ───────────────────────── Twilio-compatible ─────────────────────────

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** Sender number or alphanumeric sender id; or use `messagingServiceSid`. */
  from?: string | undefined;
  messagingServiceSid?: string | undefined;
  /** `https://api.twilio.com` or a compatible vendor's base URL. */
  baseUrl: string;
}

/** Twilio error codes that mean the number itself is unusable. */
const TWILIO_INVALID_NUMBER = new Set([21211, 21214, 21217, 21407, 21408, 21610, 21612, 21614]);

/** `POST /2010-04-01/Accounts/{sid}/Messages.json`, form-encoded, HTTP Basic auth. */
export class TwilioSmsProvider implements SmsPort {
  readonly name = 'twilio';

  constructor(
    private readonly config: TwilioSmsConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    const { accountSid, authToken } = this.config;
    if (!accountSid || !authToken || (!this.config.from && !this.config.messagingServiceSid)) {
      throw new ProviderError(this.name, 'not_configured', 'SMS_TWILIO_ACCOUNT_SID / _AUTH_TOKEN / _FROM are not set', true);
    }
    const form = new URLSearchParams({ To: formatNumber(message.to, 'e164'), Body: message.body });
    if (this.config.messagingServiceSid) form.set('MessagingServiceSid', this.config.messagingServiceSid);
    else form.set('From', this.config.from!);
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const res = await send(this.name, this.fetchImpl, url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form.toString(),
    });
    const json = parseJson(res.body);
    if (res.status < 200 || res.status >= 300) {
      const code = Number(pick(json, 'code'));
      const invalid = TWILIO_INVALID_NUMBER.has(code);
      throw new ProviderError(this.name, Number.isFinite(code) ? `twilio_${code}` : `http_${res.status}`, String(pick(json, 'message') ?? res.body.slice(0, 200)), invalid || !transientStatus(res.status), invalid);
    }
    const sid = pick(json, 'sid');
    return { provider: this.name, messageId: typeof sid === 'string' ? sid : null };
  }
}

// ───────────────────────── OTPIQ (Iraq) ─────────────────────────

/** How OTPIQ delivers a sign-in code. SMS only by default: WhatsApp is our own Meta account (Ali, 2026-10-09). */
export type OtpiqChannel = 'whatsapp-sms' | 'sms' | 'whatsapp' | 'telegram-sms' | 'whatsapp-telegram-sms' | 'auto';
const OTPIQ_CHANNELS: readonly OtpiqChannel[] = ['whatsapp-sms', 'sms', 'whatsapp', 'telegram-sms', 'whatsapp-telegram-sms', 'auto'];

export interface OtpiqConfig {
  apiKey: string;
  /** Channel for sign-in codes (default `sms`); other texts (the SMS twins of notifications) always go as SMS. */
  codeChannel: OtpiqChannel;
  senderId?: string | undefined;
  baseUrl: string;
}

/**
 * OTPIQ (otpiq.com), an Iraqi SMS service: sends our own code by SMS (`codeChannel`, which could also
 * be WhatsApp-then-SMS, but WhatsApp goes through our own Meta account). OTPIQ writes the code's
 * wording; texts that are not a code go as a plain SMS (`custom`, which needs an approved sender id).
 */
export class OtpiqSmsProvider implements SmsPort {
  readonly name = 'otpiq';

  constructor(
    private readonly config: OtpiqConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.config.apiKey) throw new ProviderError(this.name, 'not_configured', 'OTPIQ_API_KEY is not set', true);
    const phoneNumber = formatNumber(message.to, 'digits');
    const payload: Record<string, string> = message.code
      ? { phoneNumber, smsType: 'verification', verificationCode: message.code, provider: this.config.codeChannel }
      : { phoneNumber, smsType: 'custom', customMessage: message.body, provider: 'sms' };
    if (this.config.senderId) payload['senderId'] = this.config.senderId;
    const res = await send(this.name, this.fetchImpl, `${this.config.baseUrl.replace(/\/$/, '')}/api/sms`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(payload),
    });
    const json = parseJson(res.body);
    if (res.status < 200 || res.status >= 300) {
      const text = String(pick(json, 'message') ?? res.body.slice(0, 200));
      // A 400 is a bad number, an empty balance or a spending cap: retrying the same request won't help.
      const invalid = res.status === 400 && /phone/i.test(text);
      throw new ProviderError(this.name, `http_${res.status}`, text, !transientStatus(res.status), invalid);
    }
    const id = pick(json, 'smsId');
    return { provider: this.name, messageId: typeof id === 'string' ? id : null };
  }
}

// ───────────────────────── env ─────────────────────────

export type SmsProviderName = 'dev' | 'http' | 'twilio' | 'otpiq';

/** `SMS_PROVIDER`: `dev` (also the old `fake`), `http` (also the old `gateway`), `twilio`, `otpiq`. */
export function smsProviderName(env: NodeJS.ProcessEnv = process.env): SmsProviderName {
  const v = (env['SMS_PROVIDER'] ?? 'dev').trim().toLowerCase();
  if (v === 'http' || v === 'gateway') return 'http';
  if (v === 'twilio') return 'twilio';
  if (v === 'otpiq') return 'otpiq';
  return 'dev';
}

export function httpSmsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HttpSmsConfig {
  const legacyKey = env['SMS_GATEWAY_KEY'];
  const format = env['SMS_HTTP_NUMBER_FORMAT'];
  const regex = env['SMS_HTTP_SUCCESS_REGEX'];
  return {
    url: env['SMS_HTTP_URL'] ?? env['SMS_GATEWAY_URL'] ?? '',
    method: (env['SMS_HTTP_METHOD'] ?? 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
    body: env['SMS_HTTP_BODY'],
    contentType: env['SMS_HTTP_CONTENT_TYPE'] ?? 'application/json',
    authHeader: env['SMS_HTTP_AUTH_HEADER'] ?? (legacyKey ? `Authorization: Bearer ${legacyKey}` : undefined),
    senderId: env['SMS_SENDER_ID'],
    numberFormat: format === 'digits' || format === 'local' ? format : 'e164',
    successPattern: regex ? new RegExp(regex) : undefined,
    idPath: env['SMS_HTTP_ID_PATH'],
  };
}

export function twilioSmsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TwilioSmsConfig {
  return {
    accountSid: env['SMS_TWILIO_ACCOUNT_SID'] ?? '',
    authToken: env['SMS_TWILIO_AUTH_TOKEN'] ?? '',
    from: env['SMS_TWILIO_FROM'] ?? env['SMS_SENDER_ID'],
    messagingServiceSid: env['SMS_TWILIO_MESSAGING_SERVICE_SID'],
    baseUrl: env['SMS_TWILIO_BASE_URL'] ?? 'https://api.twilio.com',
  };
}

export function otpiqConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OtpiqConfig {
  const channel = (env['OTPIQ_CODE_CHANNEL'] ?? 'sms').trim().toLowerCase() as OtpiqChannel;
  return {
    apiKey: env['OTPIQ_API_KEY'] ?? '',
    codeChannel: OTPIQ_CHANNELS.includes(channel) ? channel : 'sms',
    senderId: env['SMS_SENDER_ID'],
    baseUrl: env['OTPIQ_BASE_URL'] ?? 'https://api.otpiq.com',
  };
}

/** The SMS port `SMS_PROVIDER` asks for. A misconfigured real provider fails each send loudly (permanent). */
export function smsPortFromEnv(env: NodeJS.ProcessEnv = process.env, opts: { fetchImpl?: FetchLike; log?: boolean } = {}): SmsPort {
  const name = smsProviderName(env);
  if (name === 'http') return new HttpSmsProvider(httpSmsConfigFromEnv(env), opts.fetchImpl);
  if (name === 'twilio') return new TwilioSmsProvider(twilioSmsConfigFromEnv(env), opts.fetchImpl);
  if (name === 'otpiq') return new OtpiqSmsProvider(otpiqConfigFromEnv(env), opts.fetchImpl);
  return new DevSmsProvider(opts.log ?? true);
}
