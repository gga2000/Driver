import { Controller, Get, Logger, Post, Req, Res, type RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseStatusWebhook, verifyWebhookSignature } from './providers/whatsapp.js';
import { NotifyService } from './notify.service.js';

/**
 * Meta's WhatsApp webhook (`/webhooks/whatsapp`): the GET handshake answers `hub.challenge` when
 * `hub.verify_token` equals WHATSAPP_WEBHOOK_VERIFY_TOKEN; POSTs must carry a valid
 * `X-Hub-Signature-256` (HMAC of the raw body with WHATSAPP_APP_SECRET) and their message statuses
 * (sent / delivered / read / failed) update the delivery log. Unset secrets: 404 (not exposed).
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger('WhatsAppWebhook');

  constructor(private readonly notify: NotifyService) {}

  @Get()
  verify(@Req() req: Request, @Res() res: Response): void {
    const expected = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];
    const q = req.query as Record<string, string | undefined>;
    if (!expected) {
      res.status(404).end();
      return;
    }
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === expected) {
      res.status(200).type('text/plain').send(q['hub.challenge'] ?? '');
      return;
    }
    res.status(403).end();
  }

  @Post()
  async receive(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const secret = process.env['WHATSAPP_APP_SECRET'];
    if (!secret) {
      res.status(404).end();
      return;
    }
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyWebhookSignature(raw, req.header('x-hub-signature-256'), secret)) {
      res.status(401).end();
      return;
    }
    for (const s of parseStatusWebhook(req.body)) {
      try {
        await this.notify.whatsAppStatus(s.messageId, s.status, s.at, s.error);
      } catch (err) {
        this.logger.warn(`status ${s.messageId}: ${(err as Error).message}`);
      }
    }
    // Meta retries anything but a 200; statuses for unknown ids are simply ignored.
    res.status(200).json({ ok: true });
  }
}
