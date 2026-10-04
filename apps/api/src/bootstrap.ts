import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { TrpcService } from './trpc/trpc.module.js';

export async function createApp(): Promise<NestExpressApplication> {
  // rawBody: webhook signatures (WhatsApp `X-Hub-Signature-256`) are computed over the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], rawBody: true });
  app.enableCors({ origin: true });
  // Per-IP OTP limits need the client's address: behind a load balancer set TRUST_PROXY (hop count,
  // e.g. "1", or an Express trust-proxy value) so req.ip comes from X-Forwarded-For.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  app.get(TrpcService).mount(app);
  return app;
}
