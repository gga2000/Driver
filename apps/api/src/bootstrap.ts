import 'reflect-metadata';
import { Logger, type LoggerService } from '@nestjs/common';
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
 * SEC-20: headers on every answer. The API serves JSON, images and no pages, so nothing may frame or
 * script it, browsers must not guess content types, and no referrer leaves with a link. HSTS in
 * production only (TLS ends at Fly's proxy; a laptop speaks plain HTTP).
 */
export function securityHeaders(production: boolean) {
  return (_req: unknown, res: { setHeader(name: string, value: string): unknown }, next: () => void): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export async function createApp(opts: { logger?: LoggerService } = {}): Promise<NestExpressApplication> {
  // rawBody: webhook signatures (WhatsApp `X-Hub-Signature-256`) are computed over the exact bytes.
  // Express 5 parses query strings with the "simple" parser (flat keys, no `a[b]=` nesting); tRPC reads
  // its `input` from the URL itself and the plain routes (webhook, uploads) only use flat keys.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], rawBody: true });
  const production = process.env['NODE_ENV'] === 'production';
  app.disable('x-powered-by');
  app.use(securityHeaders(production));
  const origin = corsOriginFromEnv();
  if (production && origin === true) new Logger('Bootstrap').warn('CORS_ORIGINS is not set: any web origin may call the API (set it once the web domains exist)');
  app.enableCors({ origin });
  // Per-IP OTP limits need the client's address: behind a load balancer set TRUST_PROXY (hop count,
  // e.g. "1", or an Express trust-proxy value) so req.ip comes from X-Forwarded-For.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  app.get(TrpcService).mount(app);
  return app;
}
