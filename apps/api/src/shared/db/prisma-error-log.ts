/**
 * Logs every failed Prisma query once, at `warn`, under the `Prisma` context, before rethrowing it
 * unchanged. Inside an HTTP request the logger adds the request id (`shared/request-context.ts`), so a
 * foreign-key or aborted-transaction error is attributed to the call that caused it even when the
 * caller catches it (a best-effort vault read, an idempotent insert). `warn`, not `error`: an expected
 * unique violation is not an incident, and the error reporter only takes errors.
 *
 * The line: `prisma <code> on <Model>.<operation>: <last line of the message>`; the code is Prisma's
 * (P2003 …) or, for a raw driver-adapter error, Postgres's SQLSTATE (25P02 …) when Prisma passes it on.
 */
export const PRISMA_LOG_CONTEXT = 'Prisma';

export function describePrismaError(
  err: unknown,
  model: string | undefined,
  operation: string,
): string {
  const e = err as {
    code?: unknown;
    message?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
  } | null;
  const message = typeof e?.message === 'string' ? e.message : String(err);
  const code =
    typeof e?.code === 'string'
      ? e.code
      : typeof e?.meta?.driverAdapterError?.cause?.originalCode === 'string'
        ? e.meta.driverAdapterError.cause.originalCode
        : 'unknown';
  const last =
    message
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  return `prisma ${code} on ${model ? `${model}.` : ''}${operation}: ${last.slice(0, 500)}`;
}

interface QueryParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/** The `$allOperations` hook for `client.$extends({ query: { $allOperations } })`. */
/** `warn` is a logger whose context is `PRISMA_LOG_CONTEXT` (`new Logger(PRISMA_LOG_CONTEXT)`). */
export function prismaErrorLogger(warn: (message: string) => void) {
  return async function $allOperations({
    model,
    operation,
    args,
    query,
  }: QueryParams): Promise<unknown> {
    try {
      return await query(args);
    } catch (err) {
      warn(describePrismaError(err, model, operation));
      throw err;
    }
  };
}
