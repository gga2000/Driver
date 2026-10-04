import { createApp } from './bootstrap.js';
import { API_VERSION } from './trpc/trpc.module.js';
import { EventsService } from './modules/events/index.js';
import { errorReporterFromEnv } from './shared/error-reporter.js';
import { AppLogger, logFormatFromEnv, logLevelsFromEnv } from './shared/logging.js';
import { createShutdown, shutdownOptionsFromEnv } from './shutdown.js';

const port = Number(process.env['PORT'] ?? 3000);
const reporter = errorReporterFromEnv(process.env, API_VERSION);
const logger = new AppLogger(logFormatFromEnv(), reporter, logLevelsFromEnv());

process.on('unhandledRejection', (reason) => {
  logger.error(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined, 'Process');
});
process.on('uncaughtException', (err) => {
  logger.error(`uncaught exception: ${err.message}`, err.stack, 'Process');
  void reporter.flush(2000).finally(() => process.exit(1));
});

createApp({ logger })
  .then(async (app) => {
    const shutdown = createShutdown(
      {
        getHttpServer: () => app.getHttpServer(),
        drainOutbox: () => app.get(EventsService).publisher.shutdown(),
        close: () => app.close(),
      },
      { logger, reporter, ...shutdownOptionsFromEnv(), exit: (code) => process.exit(code) },
    );
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void shutdown(signal));
    await app.listen(port);
    logger.log(`driver-api ${API_VERSION} listening on :${port}/trpc${reporter.enabled ? ' (error reporting on)' : ''}`, 'Bootstrap');
  })
  .catch(async (err: unknown) => {
    logger.error(`failed to boot driver-api: ${(err as Error)?.message ?? String(err)}`, (err as Error)?.stack, 'Bootstrap');
    await reporter.flush(2000);
    process.exit(1);
  });
