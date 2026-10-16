import { Logger } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import type { AndroidChannelId, PushTokenKind } from '@driver/contracts';
import { globalFetch, parseJson, pick, ProviderError, send, transientStatus, type FetchLike } from '../../../shared/messaging/http.js';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: AndroidChannelId;
  /** `default`, a bundled file (`offer.wav`), or null for silent. */
  sound: string | null;
  priority: 'high' | 'normal';
  ttlSec?: number;
  /** Data-only: no title, body or sound go out (the app handles `data` itself). */
  silent?: boolean;
}

/** The provider's answer for one message. `id` is what receipts are polled by (Expo). */
export interface PushTicket {
  token: string;
  ok: boolean;
  id: string | null;
  error?: string;
  /** The token is dead (uninstalled, expired): prune it. */
  invalidToken?: boolean;
}

/** Delivery to Apple / Google, as the provider learned it after the ticket. */
export interface PushReceipt {
  id: string;
  ok: boolean;
  error?: string;
  invalidToken?: boolean;
}

/**
 * A push transport. `hasReceipts`: the provider reports delivery to APNs / FCM after the fact
 * (Expo); without it an accepted message (`sent`) is the best we will know.
 */
export interface PushPort {
  readonly name: string;
  readonly hasReceipts: boolean;
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  /** Receipts for these ticket ids; ids without a receipt yet are left out. */
  receipts(ids: readonly string[]): Promise<PushReceipt[]>;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ───────────────────────── dev ─────────────────────────

/** Logs each push and answers with ok tickets and ok receipts. `dead` tokens come back DeviceNotRegistered. */
export class DevPushProvider implements PushPort {
  readonly name = 'dev';
  readonly hasReceipts = true;
  readonly sent: PushMessage[] = [];
  readonly dead = new Set<string>();
  private readonly logger = new Logger('DevPush');
  private seq = 0;

  constructor(private readonly log = true) {}

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    return messages.map((m) => {
      this.sent.push(m);
      if (this.log) this.logger.log(`→ ${m.token.slice(0, 28)}… [${m.silent ? 'data' : m.channelId}] ${m.title} — ${m.body}`);
      if (this.dead.has(m.token)) return { token: m.token, ok: false, id: null, error: 'DeviceNotRegistered', invalidToken: true };
      this.seq += 1;
      return { token: m.token, ok: true, id: `dev-ticket-${this.seq}` };
    });
  }

  async receipts(ids: readonly string[]): Promise<PushReceipt[]> {
    return ids.map((id) => ({ id, ok: true }));
  }
}

// ───────────────────────── Expo ─────────────────────────

export interface ExpoPushConfig {
  /** Required when the Expo project has "enhanced push security" on. */
  accessToken?: string | undefined;
  baseUrl: string;
}

const EXPO_SEND_BATCH = 100;
const EXPO_RECEIPTS_BATCH = 1000;

/**
 * Expo Push API: `POST /--/api/v2/push/send` with up to 100 messages per request (tickets in the
 * same order), then `POST /--/api/v2/push/getReceipts` with up to 1000 ticket ids. A ticket or
 * receipt error `DeviceNotRegistered` means the token is dead.
 */
export class ExpoPushProvider implements PushPort {
  readonly name = 'expo';
  readonly hasReceipts = true;

  constructor(
    private readonly config: ExpoPushConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
      ...(this.config.accessToken ? { authorization: `Bearer ${this.config.accessToken}` } : {}),
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await send(this.name, this.fetchImpl, `${this.config.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    const json = parseJson(res.body);
    if (res.status < 200 || res.status >= 300) {
      const code = String(pick(json, 'errors.0.code') ?? `http_${res.status}`);
      throw new ProviderError(this.name, code, String(pick(json, 'errors.0.message') ?? res.body.slice(0, 200)), !transientStatus(res.status));
    }
    return json;
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const out: PushTicket[] = [];
    for (const batch of chunks(messages, EXPO_SEND_BATCH)) {
      const json = await this.post('/--/api/v2/push/send', batch.map(toExpoMessage));
      const data = pick(json, 'data');
      if (!Array.isArray(data) || data.length !== batch.length) throw new ProviderError(this.name, 'bad_response', 'tickets do not match the batch', false);
      batch.forEach((m, i) => {
        const t = data[i] as { status?: string; id?: string; message?: string; details?: { error?: string } };
        if (t.status === 'ok' && t.id) out.push({ token: m.token, ok: true, id: t.id });
        else {
          const error = t.details?.error ?? t.message ?? 'error';
          out.push({ token: m.token, ok: false, id: null, error, invalidToken: error === 'DeviceNotRegistered' });
        }
      });
    }
    return out;
  }

  async receipts(ids: readonly string[]): Promise<PushReceipt[]> {
    const out: PushReceipt[] = [];
    for (const batch of chunks(ids, EXPO_RECEIPTS_BATCH)) {
      const json = await this.post('/--/api/v2/push/getReceipts', { ids: batch });
      const data = (pick(json, 'data') ?? {}) as Record<string, { status?: string; message?: string; details?: { error?: string } }>;
      for (const id of batch) {
        const r = data[id];
        if (!r) continue;
        if (r.status === 'ok') out.push({ id, ok: true });
        else {
          const error = r.details?.error ?? r.message ?? 'error';
          out.push({ id, ok: false, error, invalidToken: error === 'DeviceNotRegistered' });
        }
      }
    }
    return out;
  }
}

function toExpoMessage(m: PushMessage): Record<string, unknown> {
  // Data-only: no title/body (Android hands `data` to the app); `_contentAvailable` wakes iOS.
  if (m.silent) return { to: m.token, data: m.data, priority: m.priority, _contentAvailable: true, ...(m.ttlSec !== undefined ? { ttl: m.ttlSec } : {}) };
  return {
    to: m.token,
    title: m.title,
    body: m.body,
    data: m.data,
    channelId: m.channelId,
    sound: m.sound,
    priority: m.priority,
    ...(m.ttlSec !== undefined ? { ttl: m.ttlSec } : {}),
  };
}

// ───────────────────────── FCM (HTTP v1) ─────────────────────────

export interface FcmConfig {
  projectId: string;
  /** Service account (client_email + private_key) for the OAuth exchange… */
  serviceAccount?: { client_email: string; private_key: string } | undefined;
  /** …or a ready access token (short-lived; tests, or a sidecar that refreshes it). */
  accessToken?: string | undefined;
  baseUrl: string;
  tokenUrl: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * Firebase Cloud Messaging HTTP v1, for raw FCM tokens (a later bare-native build, or sending
 * without Expo). One request per message; `UNREGISTERED` / an invalid token argument means the token
 * is dead. FCM has no receipts: an accepted message stays `sent`.
 */
export class FcmPushProvider implements PushPort {
  readonly name = 'fcm';
  readonly hasReceipts = false;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: FcmConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.config.accessToken) return this.config.accessToken;
    const sa = this.config.serviceAccount;
    if (!sa) throw new ProviderError(this.name, 'not_configured', 'FCM_SERVICE_ACCOUNT_JSON or FCM_ACCESS_TOKEN is not set', true);
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const iat = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(sa.client_email)
      .setAudience(this.config.tokenUrl)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(await importPKCS8(sa.private_key, 'RS256'));
    const res = await send(this.name, this.fetchImpl, this.config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const json = parseJson(res.body);
    const token = pick(json, 'access_token');
    if (res.status !== 200 || typeof token !== 'string') throw new ProviderError(this.name, 'oauth_failed', res.body.slice(0, 200), !transientStatus(res.status));
    this.cached = { token, expiresAt: this.now() + Number(pick(json, 'expires_in') ?? 3600) * 1000 };
    return token;
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const out: PushTicket[] = [];
    const bearer = await this.accessToken();
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`;
    for (const m of messages) {
      const res = await send(this.name, this.fetchImpl, url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: m.silent
            ? {
                // Data-only: a data message on Android, a background (content-available) push on iOS.
                token: m.token,
                data: m.data,
                android: { priority: m.priority === 'high' ? 'HIGH' : 'NORMAL', ...(m.ttlSec !== undefined ? { ttl: `${m.ttlSec}s` } : {}) },
                apns: { headers: { 'apns-priority': '5', 'apns-push-type': 'background' }, payload: { aps: { 'content-available': 1 } } },
              }
            : {
                token: m.token,
                notification: { title: m.title, body: m.body },
                data: m.data,
                android: { priority: m.priority === 'high' ? 'HIGH' : 'NORMAL', ...(m.ttlSec !== undefined ? { ttl: `${m.ttlSec}s` } : {}), notification: { channel_id: m.channelId, ...(m.sound ? { sound: m.sound } : {}) } },
                apns: { headers: { 'apns-priority': m.priority === 'high' ? '10' : '5' }, payload: { aps: { ...(m.sound ? { sound: m.sound } : {}) } } },
              },
        }),
      });
      const json = parseJson(res.body);
      if (res.status >= 200 && res.status < 300) {
        out.push({ token: m.token, ok: true, id: String(pick(json, 'name') ?? '') || null });
        continue;
      }
      const status = String(pick(json, 'error.status') ?? '');
      const detail = String(pick(json, 'error.details.0.errorCode') ?? '');
      const invalid = status === 'NOT_FOUND' || detail === 'UNREGISTERED' || (status === 'INVALID_ARGUMENT' && /token/i.test(String(pick(json, 'error.message') ?? '')));
      if (!invalid && transientStatus(res.status)) throw new ProviderError(this.name, detail || status || `http_${res.status}`, res.body.slice(0, 200), false);
      out.push({ token: m.token, ok: false, id: null, error: detail || status || `http_${res.status}`, invalidToken: invalid });
    }
    return out;
  }

  async receipts(): Promise<PushReceipt[]> {
    return [];
  }
}

// ───────────────────────── by token kind ─────────────────────────

/**
 * OPS-02: a live host that is not staging. There a pretend push would report every message delivered
 * while no phone hears anything (and the SMS twin, waiting on a failed push, would never go), so the
 * API refuses to boot on the dev provider. Staging (`DEPLOY_ENVIRONMENT=staging`) may keep it.
 */
export function isLiveProduction(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] === 'production' && env['DEPLOY_ENVIRONMENT'] !== 'staging';
}

/**
 * Where no real transport is set up on a live host: every message fails (not `ok`), so the engine
 * falls back to SMS and the miss shows in the delivery log, instead of a dev ticket that lies.
 */
export class UnconfiguredPushProvider implements PushPort {
  readonly hasReceipts = false;
  constructor(readonly name: string) {}

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    return messages.map((m) => ({ token: m.token, ok: false, id: null, error: 'push_not_configured' }));
  }

  async receipts(): Promise<PushReceipt[]> {
    return [];
  }
}

/**
 * Expo tokens go to `PUSH_PROVIDER` (dev | expo); raw FCM tokens to FCM when configured. Without FCM
 * set up they go to dev on a laptop or staging, and fail (`UnconfiguredPushProvider`) on a live host.
 */
export type PushPorts = Readonly<Record<PushTokenKind, PushPort>>;

export function pushPortsFromEnv(env: NodeJS.ProcessEnv = process.env, opts: { fetchImpl?: FetchLike; log?: boolean } = {}): PushPorts {
  const live = isLiveProduction(env);
  const choice = (env['PUSH_PROVIDER'] ?? (env['EXPO_ACCESS_TOKEN'] ? 'expo' : 'dev')).toLowerCase();
  if (live && choice !== 'expo') throw new Error(`PUSH_PROVIDER must be expo on a live host (got ${choice}): a dev push reports messages delivered that no phone gets; refusing to boot`);
  const fallback: PushPort = live ? new UnconfiguredPushProvider('fcm') : new DevPushProvider(opts.log ?? true);
  const expo = choice === 'expo' ? new ExpoPushProvider({ accessToken: env['EXPO_ACCESS_TOKEN'], baseUrl: env['EXPO_PUSH_URL'] ?? 'https://exp.host' }, opts.fetchImpl) : fallback;
  let fcm: PushPort = fallback;
  if (env['FCM_PROJECT_ID'] && (env['FCM_SERVICE_ACCOUNT_JSON'] || env['FCM_ACCESS_TOKEN'])) {
    let serviceAccount: FcmConfig['serviceAccount'];
    if (env['FCM_SERVICE_ACCOUNT_JSON']) {
      const parsed = parseJson(env['FCM_SERVICE_ACCOUNT_JSON']) as { client_email?: string; private_key?: string } | null;
      if (parsed?.client_email && parsed.private_key) serviceAccount = { client_email: parsed.client_email, private_key: parsed.private_key };
    }
    fcm = new FcmPushProvider(
      { projectId: env['FCM_PROJECT_ID'], serviceAccount, accessToken: env['FCM_ACCESS_TOKEN'], baseUrl: env['FCM_BASE_URL'] ?? 'https://fcm.googleapis.com', tokenUrl: 'https://oauth2.googleapis.com/token' },
      opts.fetchImpl,
    );
  }
  return { expo, fcm };
}
