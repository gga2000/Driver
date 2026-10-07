import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { noopReporter, type ErrorReporter } from './error-reporter.js';
import { currentRequestId } from './request-context.js';

export type LogFormat = 'json' | 'pretty';

/** `LOG_FORMAT=json|pretty`; default json in production (one line per entry for the host's log search), pretty elsewhere. */
export function logFormatFromEnv(env: Record<string, string | undefined> = process.env): LogFormat {
  const f = env['LOG_FORMAT'];
  if (f === 'json' || f === 'pretty') return f;
  return env['NODE_ENV'] === 'production' ? 'json' : 'pretty';
}

/** `LOG_LEVEL=debug` adds debug and verbose; the default is log + warn + error (as before). */
export function logLevelsFromEnv(env: Record<string, string | undefined> = process.env): LogLevel[] {
  return env['LOG_LEVEL'] === 'debug' ? ['error', 'warn', 'log', 'debug', 'verbose'] : ['error', 'warn', 'log'];
}

const STACK = /\n\s+at\s/;

/**
 * The API's Nest logger. `json`: one JSON object per line on stdout
 * (`{"time","level","context","msg","stack"?,"service"}`), which Fly / Railway / Render index as is.
 * `pretty`: Nest's console logger. Inside an HTTP request each line also carries its `requestId`
 * (`shared/request-context.ts`; json: a field, pretty: a `[req …]` prefix), so a failure can be traced
 * to the call that caused it. Either way every `error` also goes to the ErrorReporter
 * (Sentry when SENTRY_DSN is set, nothing otherwise).
 */
export class AppLogger implements LoggerService {
  private readonly pretty: ConsoleLogger | null;

  constructor(
    format: LogFormat,
    private readonly reporter: ErrorReporter = noopReporter,
    private readonly levels: LogLevel[] = ['error', 'warn', 'log'],
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.pretty = format === 'pretty' ? new ConsoleLogger('', { logLevels: levels }) : null;
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    const { context, stack } = split(params);
    this.reporter.capture(message instanceof Error ? message : new ErrorWithStack(String(message), stack), { ...(context ? { logger: context } : {}) });
    this.emit('error', message, params);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.levels.splice(0, this.levels.length, ...levels);
    this.pretty?.setLogLevels(levels);
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    if (!this.levels.includes(level)) return;
    const requestId = currentRequestId();
    if (this.pretty) {
      const m = requestId && typeof message === 'string' ? `[req ${requestId}] ${message}` : message;
      (this.pretty[level] as (m: unknown, ...p: unknown[]) => void).call(this.pretty, m, ...params);
      return;
    }
    const { context, stack } = split(params);
    const entry: Record<string, unknown> = {
      time: this.now().toISOString(),
      level: level === 'log' ? 'info' : level,
      ...(context ? { context } : {}),
      msg: message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message),
      ...(stack ? { stack } : message instanceof Error && message.stack ? { stack: message.stack } : {}),
      ...(requestId ? { requestId } : {}),
      service: 'driver-api',
    };
    this.write(JSON.stringify(entry));
  }
}

/** Nest passes `(message, stack?, context?)` for errors and `(message, context?)` otherwise. */
function split(params: unknown[]): { context?: string; stack?: string } {
  const strings = params.filter((p): p is string => typeof p === 'string');
  const stack = strings.find((s) => STACK.test(s));
  const context = [...strings].reverse().find((s) => s !== stack && !STACK.test(s));
  return { ...(context ? { context } : {}), ...(stack ? { stack } : {}) };
}

class ErrorWithStack extends Error {
  constructor(message: string, stack?: string) {
    super(message);
    this.name = 'Error';
    if (stack) this.stack = stack;
  }
}
