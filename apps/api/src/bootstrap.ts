import 'reflect-metadata';
import { constants as zlib } from 'node:zlib';
import { Logger, type LoggerService } from '@nestjs/common';
import compression from 'compression';
import type { Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { TRPC_PATH, TrpcService } from './trpc/trpc.module.js';
import { AppLogger } from './shared/logging.js';
import { Metrics } from './shared/metrics.js';
import { createRequestLog, type RequestLogLine } from './shared/request-log.js';

/** `REQUEST_LOG=on|off`: one line per /trpc request (plan 7.4). On by default in production only; metrics are always kept. */
export function requestLogFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = env['REQUEST_LOG']?.trim().toLowerCase();
  if (v === 'on' || v === 'true' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === '0') return false;
  return env['NODE_ENV'] === 'production';
}

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
 * The API's CORS options. `Date` is exposed so the web app can read the server's clock from any response
 * (THIN-10: the iftar countdown); phones read headers without CORS.
 */
export function corsOptions(env: Record<string, string | undefined> = process.env): { origin: true | string[]; exposedHeaders: string[] } {
  return { origin: corsOriginFromEnv(env), exposedHeaders: ['Date'] };
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

export async function createApp(opts: { logger?: LoggerService; metrics?: Metrics } = {}): Promise<NestExpressApplication> {
  // rawBody: webhook signatures (WhatsApp `X-Hub-Signature-256`) are computed over the exact bytes.
  // Express 5 parses query strings with the "simple" parser (flat keys, no `a[b]=` nesting); tRPC reads
  // its `input` from the URL itself and the plain routes (webhook, uploads) only use flat keys.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], rawBody: true });
  const production = process.env['NODE_ENV'] === 'production';
  app.disable('x-powered-by');
  app.use(securityHeaders(production));
  const cors = corsOptions();
  if (production && cors.origin === true) new Logger('Bootstrap').warn('CORS_ORIGINS is not set: any web origin may call the API (set it once the web domains exist)');
  app.enableCors(cors);
  app.use(compression(compressionOptions));
  // Per-IP OTP limits need the client's address: behind a load balancer set TRUST_PROXY (hop count,
  // e.g. "1", or an Express trust-proxy value) so req.ip comes from X-Forwarded-For.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  // Request log + RED metrics (CRIT1-03): mounted before tRPC so it sees every answer, including refusals.
  const logRequests = requestLogFromEnv();
  const requestLogger = new Logger('Request');
  const write = (line: RequestLogLine) => {
    if (!logRequests) return;
    if (opts.logger instanceof AppLogger) opts.logger.fields('Request', 'request', { ...line });
    else requestLogger.log(`request ${JSON.stringify(line)}`);
  };
  app.use(TRPC_PATH, createRequestLog(opts.metrics ?? new Metrics(), write));
  app.get(TrpcService).mount(app);
  return app;
}
