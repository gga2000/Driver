import type { PoolConfig } from 'pg';

/**
 * How the API (and the seed / setup scripts) open their node-postgres pool. Only what a hosted
 * database needs beyond the URL; with nothing set this is exactly `{ connectionString }`.
 */
export interface DbConnectionOptions {
  /**
   * PEM text of the CA that signs the server certificate (Supabase: Project Settings → Database →
   * SSL Configuration → Download certificate). When set, TLS is required and the server certificate
   * is verified against it; any `sslmode` in the URL is dropped, because node-postgres lets the URL's
   * `sslmode` override the `ssl` option.
   */
  caCert?: string;
  /** Pooled connections this process may hold (node-postgres default 10). */
  maxConnections?: number;
}

const SSL_URL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

/** `DATABASE_CA_CERT` (PEM; `\n` escapes accepted, as some secret stores flatten newlines) and `DATABASE_POOL_MAX`. */
export function dbOptionsFromEnv(env: Record<string, string | undefined> = process.env): DbConnectionOptions {
  const pem = env['DATABASE_CA_CERT']?.trim();
  const max = Number(env['DATABASE_POOL_MAX']);
  return {
    ...(pem ? { caCert: pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem } : {}),
    ...(Number.isInteger(max) && max > 0 ? { maxConnections: max } : {}),
  };
}

/** The node-postgres pool config for `connectionString` with `opts` applied. */
export function pgPoolConfig(connectionString: string, opts: DbConnectionOptions = {}): PoolConfig {
  const config: PoolConfig = { connectionString };
  if (opts.maxConnections) config.max = opts.maxConnections;
  if (opts.caCert) {
    const url = new URL(connectionString);
    for (const p of SSL_URL_PARAMS) url.searchParams.delete(p);
    config.connectionString = url.toString();
    config.ssl = { ca: opts.caCert, rejectUnauthorized: true };
  }
  return config;
}
