import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import driver from '../../eslint-rules/query-states.mjs';

/** The `driver/query-handles-error` lint rule on small screens (audit W8). */
function lint(code: string, filename = 'app/new-screen.tsx'): string[] {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [{ files: ['**/*.tsx'], languageOptions: { parser: tseslint.parser as Linter.Parser }, plugins: { driver }, rules: { 'driver/query-handles-error': 'error' } }],
    { filename: `${process.cwd()}/${filename}` },
  );
  return messages.map((m) => m.message);
}

describe('driver/query-handles-error', () => {
  it('fails a screen that reads a query and never handles its failure', () => {
    const out = lint(`export default function S() { const me = useMe(); return me.isPending ? null : <T>{me.data?.name}</T>; }`);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('`me` reads the query');
  });

  it('passes a screen that branches on isError or error', () => {
    expect(lint(`export default function S() { const me = useMe(); if (me.isError) return <E/>; return <T>{me.data?.name}</T>; }`)).toEqual([]);
    expect(lint(`export default function S() { const q = useQuery(o); return q.error ? <E/> : <T>{q.data}</T>; }`)).toEqual([]);
  });

  it('passes a screen that hands the query to QueryBoundary', () => {
    expect(lint(`export default function S() { const me = useMe(); return <QueryBoundary query={me} skeleton={null}>{(d) => <T>{d.name}</T>}</QueryBoundary>; }`)).toEqual([]);
  });

  it('ignores hooks whose data it never reads, and React state', () => {
    expect(lint(`export default function S() { const send = useSend(); const [x] = useState(0); send.mutate(x); return null; }`)).toEqual([]);
  });

  it('holds screens from before the rule to their baseline count', () => {
    const wallet = `export default function S() { const a = useA(); const b = useB(); const c = useC(); const d = useD(); const e = useE(); return <T>{a.data}{b.data}{c.data}{d.data}{e.data}</T>; }`;
    // app/(tabs)/wallet.tsx is listed with 4: a fifth unhandled query fails, the listed four pass.
    expect(lint(wallet, 'app/(tabs)/wallet.tsx')[0]).toContain('has 5 queries without an error state; the baseline allows 4');
    expect(lint(wallet.replace('{e.data}', ''), 'app/(tabs)/wallet.tsx')).toEqual([]);
    // Fixing one means lowering the entry, so the list only shrinks.
    expect(lint(wallet.replace('{e.data}', '').replace('{d.data}', ''), 'app/(tabs)/wallet.tsx')[0]).toContain('lower its entry');
  });
});
