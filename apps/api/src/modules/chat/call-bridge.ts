import { DriverError } from '@driver/contracts';

/**
 * Masked calls (notifications & support §2 "outbound masked calls only"). A call bridge connects
 * the two parties of an order without either seeing the other's number.
 *
 * Production: a telephony provider (an Iraqi SIP trunk or a CPaaS) bridges both legs through a
 * platform number. `ProxyCallBridge` returns that number from config (`CALL_PROXY_NUMBER`) — the app
 * dials it and the provider routes the call by the caller's number and the open session. Until a
 * provider is contracted the number is unset and every request is refused with `call_unavailable`
 * ("اتصل من خلال التطبيق غير متوفر"). It never returns a person's own number.
 *
 * Development: `DevCallBridge` returns the other party's real number so the flow can be tried end to
 * end on a phone. It reads it through identity (a logged vault access) and refuses outside
 * NODE_ENV development / test.
 */
export interface CallBridgeRequest {
  callId: string;
  orderId: string;
  callerId: string;
  calleeId: string;
}

export interface CallBridgeSession {
  mode: 'proxy' | 'dev_direct';
  dial: string;
  expiresAt: Date;
}

export interface CallBridgePort {
  open(req: CallBridgeRequest, now: Date): Promise<CallBridgeSession>;
}

export const CALL_BRIDGE = Symbol('CALL_BRIDGE');

/** How long the app may take to start dialling after asking (the provider session's lifetime). */
export const CALL_SESSION_MS = 2 * 60_000;

/** The development environments in which a raw number may be handed out. */
export function isDevEnvironment(nodeEnv: string | undefined): boolean {
  const env = nodeEnv ?? 'development';
  return env === 'development' || env === 'test';
}

export interface CallPhoneReader {
  /** Logged vault read of a person's own number (identity's `phoneForCall`). */
  phoneForCall(personId: string, accessorId: string, purpose: string): Promise<string | null>;
}

export class DevCallBridge implements CallBridgePort {
  constructor(
    private readonly phones: CallPhoneReader,
    private readonly nodeEnv: () => string | undefined = () => process.env['NODE_ENV'],
  ) {}

  async open(req: CallBridgeRequest, now: Date): Promise<CallBridgeSession> {
    // Belt and braces: the module binds this bridge only in development, and it checks again.
    if (!isDevEnvironment(this.nodeEnv())) throw new DriverError('call_unavailable');
    const phone = await this.phones.phoneForCall(req.calleeId, req.callerId, 'masked_call_dev');
    if (!phone) throw new DriverError('call_unavailable');
    return { mode: 'dev_direct', dial: phone, expiresAt: new Date(now.getTime() + CALL_SESSION_MS) };
  }
}

export class ProxyCallBridge implements CallBridgePort {
  constructor(private readonly proxyNumber: string | undefined) {}

  async open(_req: CallBridgeRequest, now: Date): Promise<CallBridgeSession> {
    // TODO(telephony): register the session (callId → caller, callee, expiry) with the provider so
    // the platform number routes this caller to the callee only.
    const dial = this.proxyNumber?.trim();
    if (!dial) throw new DriverError('call_unavailable');
    return { mode: 'proxy', dial, expiresAt: new Date(now.getTime() + CALL_SESSION_MS) };
  }
}
