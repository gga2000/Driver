import 'reflect-metadata';
import { constants as zlib } from 'node:zlib';
import type { LoggerService } from '@nestjs/common';
import compression from 'compression';
import type { Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { TrpcService } from './trpc/trpc.module.js';

/**
 * `CORS_ORIGINS` (comma-separated, e.g. `https://app.driver.iq,https://console.driver.iq`) limits which
 * web origins may call the API from a browser. Unset: any origin (development, and the default until
 * the domains exist). Native apps send no Origin and are unaffected. Credentials are bearer tokens,
 * never cookies, so the list guards against other sites using a signed-in browser tab, not more.
 */
export function corsOriginFromEnv(env: Record<string, string | undefined> = process.env): true | string[] {
  const list = (env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length ? list : true;
}

/**
 * Answers are gzip- or brotli-compressed when the caller accepts it (phones and browsers do): JSON
 * shrinks 7–9×, so a live order costs about a tenth of the mobile data. Levels are chosen for CPU, not
 * the last percent (brotli's default quality 11 would cost more CPU than the whole request). Live
 * streams (`text/event-stream`) are never compressed: a compressor holds bytes back until its buffer
 * fills, so a ping or a position would arrive late.
 */
export const compressionOptions: compression.CompressionOptions = {
  threshold: 1024,
  level: 5,
  brotli: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
  filter: (req: Request, res: Response) => !isEventStream(req, res) && compression.filter(req, res),
};

function isEventStream(req: Request, res: Response): boolean {
  const type = res.getHeader('Content-Type');
  return String(type ?? '').startsWith('text/event-stream') || String(req.headers.accept ?? '').includes('text/event-stream');
}

export async function createApp(opts: { logger?: LoggerService } = {}): Promise<NestExpressApplication> {
  // rawBody: webhook signatures (WhatsApp `X-Hub-Signature-256`) are computed over the exact bytes.
  // Express 5 parses query strings with the "simple" parser (flat keys, no `a[b]=` nesting); tRPC reads
  // its `input` from the URL itself and the plain routes (webhook, uploads) only use flat keys.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], rawBody: true });
  app.enableCors({ origin: corsOriginFromEnv() });
  app.use(compression(compressionOptions));
  // Per-IP OTP limits need the client's address: behind a load balancer set TRUST_PROXY (hop count,
  // e.g. "1", or an Express trust-proxy value) so req.ip comes from X-Forwarded-For.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  app.get(TrpcService).mount(app);
  return app;
}
