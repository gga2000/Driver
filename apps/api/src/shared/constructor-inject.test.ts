import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A decorated class's constructor parameter typed as a union with a named type (`x: SomeService | null`)
 * gets `Object` as its design-time type, so Nest cannot tell what to inject: without `@Optional()` the
 * app fails to boot, with it the parameter is silently undefined. Such a parameter needs `@Inject(...)`.
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const decoratorName = (d: ts.Decorator): string => {
  const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  return ts.isIdentifier(e) ? e.text : '';
};
const unwrap = (t: ts.TypeNode): ts.TypeNode => (ts.isParenthesizedTypeNode(t) ? unwrap(t.type) : t);

describe('constructor injection', () => {
  it('every union-typed constructor parameter naming a type has @Inject', () => {
    const offenders: string[] = [];
    for (const file of walk(src)) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && ts.getDecorators(node)?.length) {
          for (const ctor of node.members.filter(ts.isConstructorDeclaration)) {
            for (const p of ctor.parameters) {
              const type = p.type && unwrap(p.type);
              if (!type || !ts.isUnionTypeNode(type) || !type.types.some((t) => ts.isTypeReferenceNode(unwrap(t)))) continue;
              if ((ts.getDecorators(p) ?? []).some((d) => decoratorName(d) === 'Inject')) continue;
              const line = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
              offenders.push(`${relative(src, file).replaceAll('\\', '/')}:${line} ${p.name.getText(sf)}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
