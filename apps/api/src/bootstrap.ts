import 'reflect-metadata';
import type { LoggerService } from '@nestjs/common';
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

export async function createApp(opts: { logger?: LoggerService } = {}): Promise<NestExpressApplication> {
  // rawBody: webhook signatures (WhatsApp `X-Hub-Signature-256`) are computed over the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], rawBody: true });
  app.enableCors({ origin: corsOriginFromEnv() });
  // Per-IP OTP limits need the client's address: behind a load balancer set TRUST_PROXY (hop count,
  // e.g. "1", or an Express trust-proxy value) so req.ip comes from X-Forwarded-For.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  app.get(TrpcService).mount(app);
  return app;
}
