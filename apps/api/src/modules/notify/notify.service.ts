import { Inject, Injectable, Optional } from '@nestjs/common';

export type Channel = 'push' | 'sms' | 'whatsapp';

export interface Notification {
  to: string;
  channel: Channel;
  title_ar: string;
  body_ar: string;
  data?: Record<string, string>;
}

export interface Transport {
  send(n: Notification): Promise<void>;
}

export const NOTIFY_TRANSPORT = Symbol('NOTIFY_TRANSPORT');

/** Default transport until Firebase / SMS gateway / WhatsApp are wired: keeps an inspectable log. */
export class RecordingTransport implements Transport {
  readonly sent: Notification[] = [];
  async send(n: Notification): Promise<void> {
    this.sent.push(n);
  }
}

@Injectable()
export class NotifyService {
  private readonly transport: Transport;

  constructor(@Optional() @Inject(NOTIFY_TRANSPORT) transport?: Transport) {
    this.transport = transport ?? new RecordingTransport();
  }

  /** Push first; SMS fallback is a policy the caller opts into for critical messages. */
  async send(n: Notification, fallback?: Channel): Promise<void> {
    try {
      await this.transport.send(n);
    } catch (err) {
      if (!fallback) throw err;
      await this.transport.send({ ...n, channel: fallback });
    }
  }
}
