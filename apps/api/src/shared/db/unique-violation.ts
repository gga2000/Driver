/**
 * A unique-constraint failure from Postgres, however it reached us: Prisma's P2002 (model queries),
 * P2010 carrying SQLSTATE 23505 (raw queries), or the driver's own error (code 23505), possibly
 * wrapped as `cause`. Used where a double tap may race a first write (RDB-04): the loser reads the
 * winner's row back instead of answering 500.
 */
export function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (typeof err !== 'object' || err === null || depth > 3) return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown; cause?: unknown };
  if (e.code === 'P2002' || e.code === '23505') return true;
  if (e.code === 'P2010' && (e.meta?.code === '23505' || /23505|unique constraint/i.test(String(e.message ?? '')))) return true;
  return isUniqueViolation(e.cause, depth + 1);
}
