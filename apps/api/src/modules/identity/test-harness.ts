import type { Tx } from '@driver/db';
import { FakeClock } from '../../shared/clock.js';
import { UnitOfWork, type TransactionRunner } from '../../shared/db/unit-of-work.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { IdentityService } from './identity.service.js';
import { InMemoryIdentityRepository } from './memory.repository.js';
import { DEFAULT_OTP_GUARD, OtpGuard, RecordingOtpAlerts, type OtpGuardConfig } from './rate-limit.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';
import { SessionService } from './session.service.js';
import type { StagingTestConfig } from './staging-test.js';
import type { StaffTotpConfig } from './totp.js';
import { FakeSmsProvider } from './sms/fake.provider.js';
import { DevWhatsAppProvider, whatsAppPortFromEnv } from '../../shared/messaging/whatsapp.js';

export const PEPPER = 'test-pepper';

/** Fake transaction runner: no database, one fake Tx per run, records commits/rollbacks. */
export function fakeRunner() {
  const log: string[] = [];
  let n = 0;
  const runner: TransactionRunner = {
    async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      n += 1;
      try {
        const out = await fn({ txId: n } as unknown as Tx);
        log.push(`commit ${n}`);
        return out;
      } catch (err) {
        log.push(`rollback ${n}`);
        throw err;
      }
    },
  };
  return { runner, log };
}

/** Builds an IdentityService on in-memory everything. Shared by the unit tests. */
export function harness(start = '2026-10-02T09:00:00Z', opts: { otpGuard?: Partial<OtpGuardConfig>; noWhatsApp?: boolean; whatsappEnv?: NodeJS.ProcessEnv; stagingTest?: StagingTestConfig; authenticator?: StaffTotpConfig } = {}) {
  const clock = new FakeClock(start);
  const repo = new InMemoryIdentityRepository();
  const sms = new FakeSmsProvider(false);
  const events = new RecordingEventEmitter();
  const { runner, log } = fakeRunner();
  const uow = new UnitOfWork(runner);
  const sessions = new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: 'unit-test-secret' }], activeKid: 'k1' });
  const otpAlerts = new RecordingOtpAlerts();
  const counter = new InMemoryWindowCounter(clock);
  const otpGuard = new OtpGuard(counter, otpAlerts, { ...DEFAULT_OTP_GUARD, ...opts.otpGuard });
  const whatsapp = opts.noWhatsApp || opts.whatsappEnv ? undefined : new DevWhatsAppProvider(false);
  // `whatsappEnv`: the port exactly as the module builds it from that environment.
  const whatsappPort = opts.whatsappEnv ? whatsAppPortFromEnv(opts.whatsappEnv, { log: false }) : whatsapp;
  const service = new IdentityService(repo, events, sms, clock, uow, PEPPER, sessions, otpGuard, whatsappPort, opts.stagingTest ?? null, opts.authenticator ?? null);

  /** Full login: request → read fake SMS → verify. */
  async function login(phone: string, device?: { fingerprint: string; platform: 'android' | 'ios' | 'web' }, sharedFamilyPhone?: boolean) {
    await service.requestOtp({ phone, purpose: 'login' });
    const code = sms.lastCodeFor(normalize(phone))!;
    const res = await service.verifyOtp({ phone, code, device, sharedFamilyPhone });
    return { ...res, actor: await actorFor(res.tokens.accessToken) };
  }

  async function actorFor(accessToken: string) {
    const claims = await service.verifyAccessToken(accessToken);
    return { personId: claims.sub, sessionId: claims.sid, ...(claims.did ? { deviceId: claims.did } : {}) };
  }

  return { clock, repo, sms, whatsapp, whatsappPort, events, uow, log, service, sessions, otpAlerts, counter, login, actorFor };
}

function normalize(phone: string): string {
  const d = phone.replace(/[^\d]/g, '');
  const nat = d.startsWith('964') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d;
  return `+964${nat}`;
}
