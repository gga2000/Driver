import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voiceProblems } from '@driver/i18n';
import { describe, expect, it } from 'vitest';

/**
 * The API's own Arabic (texts it sends: refusals, receipts, board labels, nudges) follows the same
 * glossary as the apps (audit S-09). Most copy lives in packages/i18n already; this guards what is
 * still written next to the code. Comments are ignored; string literals with Arabic are checked.
 */
const root = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/test-harness/.test(name) ? [p] : [];
  });
}

function arabicLiterals(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)) {
    const s = m[1] ?? m[2] ?? m[3] ?? '';
    if (/[؀-ۿ]/.test(s)) out.push(s);
  }
  return out;
}

describe('API Arabic follows the voice glossary', () => {
  it('no banned word in a string the API can send', () => {
    const table: Record<string, string> = {};
    for (const file of sources(root)) {
      arabicLiterals(readFileSync(file, 'utf8')).forEach((s, i) => {
        table[`${relative(root, file)}#${i}`] = s;
      });
    }
    expect(Object.keys(table).length).toBeGreaterThan(50);
    // The phone parser's Eastern-digit table is input handling, not copy.
    const problems = voiceProblems(table).filter((p) => p.problem !== 'exclamation mark' && !p.key.startsWith('modules/identity/phone.ts'));
    expect(problems.map((p) => `${p.key}: ${p.problem} — ${p.value}`)).toEqual([]);
  });
});
