import { describe, expect, it } from 'vitest';
import { dbOptionsFromEnv, pgPoolConfig } from './connection.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('pgPoolConfig', () => {
  it('is just the URL when nothing is configured (laptop, CI)', () => {
    expect(pgPoolConfig('postgresql://postgres:postgres@localhost:5432/driver')).toEqual({
      connectionString: 'postgresql://postgres:postgres@localhost:5432/driver',
    });
  });

  it('with a CA: verifies the server against it and drops sslmode, which pg would let override `ssl`', () => {
    const c = pgPoolConfig('postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&application_name=api', {
      caCert: PEM,
      maxConnections: 5,
    });
    expect(c.connectionString).toBe('postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?application_name=api');
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(c.max).toBe(5);
  });

  it('passes a statement time limit to every connection it opens; 0 leaves the server limit', () => {
    expect(pgPoolConfig('postgresql://localhost/driver', { statementTimeoutMs: 5000 }).statement_timeout).toBe(5000);
    expect(pgPoolConfig('postgresql://localhost/driver', { statementTimeoutMs: 0 })).not.toHaveProperty('statement_timeout');
  });
});

describe('dbOptionsFromEnv', () => {
  it('reads DATABASE_CA_CERT (flattened \\n escapes too) and DATABASE_POOL_MAX', () => {
    expect(dbOptionsFromEnv({})).toEqual({});
    expect(dbOptionsFromEnv({ DATABASE_CA_CERT: PEM.replace(/\n/g, '\\n'), DATABASE_POOL_MAX: '8' })).toEqual({ caCert: PEM, maxConnections: 8 });
    expect(dbOptionsFromEnv({ DATABASE_CA_CERT: '  ', DATABASE_POOL_MAX: 'x' })).toEqual({});
  });
});
