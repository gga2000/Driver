import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Colours come only from @driver/design-tokens through the generated CSS variables (DESIGN.md). This
 * fails on any raw hex (#E08A1E), rgb()/rgba()/hsl() literal or a Tailwind arbitrary colour
 * (bg-[#…]) anywhere in apps/console/src — except the palette generator itself. Comments are ignored
 * ("#1284" order numbers are 4 digits, not a colour length, so they never match).
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set(['theme/palette.ts']);
const RAW = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

describe('no raw colours in the Console', () => {
  it('every colour is a theme role', () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      if (ALLOWED.has(rel)) continue;
      stripComments(readFileSync(f, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const m = RAW.exec(line);
          if (m) hits.push(`${rel}:${i + 1}  ${m[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('catches what it should', () => {
    expect(RAW.test("className='bg-[#E1ECF7]'")).toBe(true);
    expect(RAW.test("fill='#d03b3b'")).toBe(true);
    expect(RAW.test('rgba(0, 0, 0, 0.6)')).toBe(true);
    expect(RAW.test('rgb(var(--c-accent) / 0.2)')).toBe(false);
    expect(RAW.test('طلب #1284')).toBe(false);
  });
});
