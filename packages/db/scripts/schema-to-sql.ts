/**
 * Offline DDL generator for the hand-maintained migration.
 *
 * Prisma's schema engine (which writes migrations) is a native binary that cannot be
 * downloaded in sandboxed environments, so this script derives the CREATE TYPE / CREATE TABLE /
 * index / foreign-key statements straight from `schema.prisma`, following Prisma's own naming
 * conventions (`<table>_pkey`, `<table>_<cols>_key`, `<table>_<cols>_idx`, `<table>_<col>_fkey`)
 * so a later `prisma migrate diff` against a real database reports no drift.
 *
 * Usage: tsx scripts/schema-to-sql.ts > /tmp/generated.sql   (then paste into the migration)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../prisma/schema.prisma'), 'utf8');

interface Field {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  attrs: string;
  column: string;
}
interface Model {
  name: string;
  table: string;
  schema: string;
  fields: Field[];
  blockAttrs: string[];
}

const enums = new Map<string, { schema: string; values: string[] }>();
for (const m of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
  const lines = m[2]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
  const sch = /@@schema\("(\w+)"\)/.exec(m[2]!)?.[1] ?? 'public';
  enums.set(m[1]!, { schema: sch, values: lines.filter((l) => !l.startsWith('@@')) });
}

const models: Model[] = [];
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const body = m[2]!;
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
  const fields: Field[] = [];
  const blockAttrs: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) {
      blockAttrs.push(line);
      continue;
    }
    const parts = line.split(/\s+/);
    const name = parts[0]!;
    let rawType = parts[1]!;
    const attrs = line.slice(line.indexOf(rawType) + rawType.length).trim();
    if (rawType.startsWith('Unsupported(')) {
      const full = /Unsupported\("([^"]+)"\)(\??)/.exec(line)!;
      rawType = `Unsupported:${full[1]}${full[2]}`;
    }
    const optional = rawType.endsWith('?');
    const list = rawType.endsWith('[]');
    const type = rawType.replace(/\?$|\[\]$/, '');
    const column = /@map\("([^"]+)"\)/.exec(attrs)?.[1] ?? name;
    fields.push({ name, type, optional, list, attrs, column });
  }
  const table = blockAttrs.map((a) => /@@map\("([^"]+)"\)/.exec(a)?.[1]).find(Boolean) ?? m[1]!;
  const sch = blockAttrs.map((a) => /@@schema\("([^"]+)"\)/.exec(a)?.[1]).find(Boolean) ?? 'public';
  models.push({ name: m[1]!, table, schema: sch, fields, blockAttrs });
}
const modelByName = new Map(models.map((m) => [m.name, m]));

const isRelationField = (f: Field) => modelByName.has(f.type) && !f.type.startsWith('Unsupported');

function sqlType(f: Field, model: Model): string {
  if (f.type.startsWith('Unsupported:')) return f.type.slice('Unsupported:'.length).replace(/\?$/, '');
  const scalar: Record<string, string> = {
    String: 'TEXT',
    Int: 'INTEGER',
    BigInt: 'BIGINT',
    Float: 'DOUBLE PRECISION',
    Boolean: 'BOOLEAN',
    DateTime: 'TIMESTAMP(3)',
    Json: 'JSONB',
  };
  let base: string;
  if (scalar[f.type]) base = scalar[f.type]!;
  else if (enums.has(f.type)) base = `"${enums.get(f.type)!.schema}"."${f.type}"`;
  else throw new Error(`${model.name}.${f.name}: unknown type ${f.type}`);
  return f.list ? `${base}[]` : base;
}

function defaultSql(f: Field): string | undefined {
  const d = /@default\(((?:"[^"]*"|[^()])*(?:\(\))?)\)/.exec(f.attrs);
  if (!d) return undefined;
  const v = d[1]!;
  if (v === 'now()') return 'CURRENT_TIMESTAMP';
  if (v === 'cuid()' || v === 'uuid()') return undefined; // generated client-side
  if (v === 'true' || v === 'false') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (v.startsWith('"')) {
    if (f.type === 'Json') return `'${v.slice(1, -1).replace(/'/g, "''")}'`;
    return `'${v.slice(1, -1).replace(/'/g, "''")}'`;
  }
  if (v === '[]') return 'ARRAY[]::' + sqlType(f, { name: '', table: '', schema: '', fields: [], blockAttrs: [] });
  if (enums.has(f.type)) return `'${v}'`;
  throw new Error(`unknown default ${v} on ${f.name}`);
}

const cols = (list: string) => list.split(',').map((c) => c.trim());
const colName = (m: Model, fieldName: string) => {
  const f = m.fields.find((x) => x.name === fieldName);
  if (!f) throw new Error(`${m.name}.${fieldName} not found`);
  return f.column;
};

const out: string[] = [];
const emit = (s: string) => out.push(s);

emit('-- ───────────── enums ─────────────');
for (const [name, e] of enums) {
  emit(`CREATE TYPE "${e.schema}"."${name}" AS ENUM (${e.values.map((v) => `'${v}'`).join(', ')});`);
}
emit('');
emit('-- ───────────── tables ─────────────');
for (const m of models) {
  const lines: string[] = [];
  const idFields = m.fields.filter((f) => /@id\b/.test(f.attrs));
  const compositeId = m.blockAttrs.map((a) => /@@id\(\[([^\]]+)\]\)/.exec(a)?.[1]).find(Boolean);
  for (const f of m.fields) {
    if (isRelationField(f)) continue;
    if (f.list && modelByName.has(f.type)) continue;
    const parts = [`"${f.column}"`, sqlType(f, m)];
    if (!f.optional) parts.push('NOT NULL');
    const d = defaultSql(f);
    if (d !== undefined) parts.push(`DEFAULT ${d}`);
    lines.push(`    ${parts.join(' ')}`);
  }
  const pk = compositeId ? cols(compositeId).map((c) => `"${colName(m, c)}"`) : idFields.map((f) => `"${f.column}"`);
  lines.push(`    CONSTRAINT "${m.table}_pkey" PRIMARY KEY (${pk.join(', ')})`);
  emit(`CREATE TABLE "${m.schema}"."${m.table}" (\n${lines.join(',\n')}\n);`);
  emit('');
}

emit('-- ───────────── unique constraints & indexes ─────────────');
for (const m of models) {
  for (const f of m.fields) {
    if (/@unique\b/.test(f.attrs) && !isRelationField(f)) {
      emit(`CREATE UNIQUE INDEX "${m.table}_${f.column}_key" ON "${m.schema}"."${m.table}"("${f.column}");`);
    }
  }
  for (const a of m.blockAttrs) {
    const u = /@@unique\(\[([^\]]+)\]\)/.exec(a);
    if (u) {
      const cs = cols(u[1]!).map((c) => colName(m, c));
      emit(`CREATE UNIQUE INDEX "${m.table}_${cs.join('_')}_key" ON "${m.schema}"."${m.table}"(${cs.map((c) => `"${c}"`).join(', ')});`);
    }
    const i = /@@index\(\[([^\]]+)\](?:,\s*type:\s*(\w+))?\)/.exec(a);
    if (i) {
      const cs = cols(i[1]!).map((c) => colName(m, c));
      const using = i[2] ? ` USING ${i[2].toUpperCase()}` : '';
      emit(`CREATE INDEX "${m.table}_${cs.join('_')}_idx" ON "${m.schema}"."${m.table}"${using}(${cs.map((c) => `"${c}"`).join(', ')});`);
    }
  }
}
emit('');
emit('-- ───────────── foreign keys ─────────────');
for (const m of models) {
  for (const f of m.fields) {
    const rel = /@relation\(([^)]*)\)/.exec(f.attrs);
    if (!rel || !isRelationField(f)) continue;
    const fieldsM = /fields:\s*\[([^\]]+)\]/.exec(rel[1]!);
    const refsM = /references:\s*\[([^\]]+)\]/.exec(rel[1]!);
    if (!fieldsM || !refsM) continue;
    const target = modelByName.get(f.type)!;
    const fcols = cols(fieldsM[1]!).map((c) => colName(m, c));
    const rcols = cols(refsM[1]!).map((c) => colName(target, c));
    const onDelete = f.optional ? 'SET NULL' : 'RESTRICT';
    emit(
      `ALTER TABLE "${m.schema}"."${m.table}" ADD CONSTRAINT "${m.table}_${fcols.join('_')}_fkey" FOREIGN KEY (${fcols.map((c) => `"${c}"`).join(', ')}) REFERENCES "${target.schema}"."${target.table}"(${rcols.map((c) => `"${c}"`).join(', ')}) ON DELETE ${onDelete} ON UPDATE CASCADE;`,
    );
  }
}

process.stdout.write(out.join('\n') + '\n');
