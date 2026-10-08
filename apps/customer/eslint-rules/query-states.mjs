/**
 * `driver/query-handles-error` (audit W8, pattern `skeleton_forever_error_states`): a screen that reads a
 * query's data must also say what happens when it fails. A query result (`useQuery(…)` or a feature
 * hook such as `useMe()`) whose `.data` / `.isPending` is read passes when the screen reads its
 * `.isError` / `.error` / `.status`, or hands the whole result on (`<QueryBoundary query={me}>`, a
 * helper call). Otherwise the screen shows a skeleton or nothing forever when the request fails.
 *
 * Screens that predate the rule are listed in `query-states-baseline.json` with their count; the list
 * may only shrink (a screen above its count fails, and so does a stale entry once it is fixed).
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const READS = new Set(['data', 'isPending', 'isLoading']);
const HANDLES = new Set(['isError', 'error', 'status', 'isSuccess', 'failureReason']);
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('./query-states-baseline.json', import.meta.url), 'utf8'));

const isHookCall = (node) =>
  node?.type === 'CallExpression' && node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name) && node.callee.name !== 'useState' && node.callee.name !== 'useRef';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'A screen that reads a query must handle its error (QueryBoundary or isError).' },
    messages: {
      missing: '`{{name}}` reads the query but never handles a failure: wrap it in <QueryBoundary query={{{name}}}> or branch on `{{name}}.isError` (audit W8).',
      over: '{{file}} has {{count}} queries without an error state; the baseline allows {{allowed}}. Handle the new one (QueryBoundary or isError).',
      stale: '{{file}} is down to {{count}} queries without an error state (baseline {{allowed}}): lower its entry in eslint-rules/query-states-baseline.json.',
    },
    schema: [],
  },
  create(context) {
    const file = relative(appRoot, context.filename).split('\\').join('/');
    const offenders = [];
    return {
      'Program:exit'(program) {
        const scopeManager = context.sourceCode.scopeManager;
        for (const scope of scopeManager.scopes) {
          for (const variable of scope.variables) {
            const def = variable.defs[0];
            if (!def || def.type !== 'Variable' || def.node.id.type !== 'Identifier' || !isHookCall(def.node.init)) continue;
            let reads = false;
            let handled = false;
            for (const ref of variable.references) {
              const parent = ref.identifier.parent;
              if (parent.type === 'MemberExpression' && parent.object === ref.identifier && !parent.computed) {
                const prop = parent.property.name;
                if (READS.has(prop)) reads = true;
                if (HANDLES.has(prop)) handled = true;
              } else if (ref.identifier !== def.node.id) {
                // Passed on whole (a boundary, a helper): whoever receives it handles it.
                handled = true;
              }
            }
            if (reads && !handled) offenders.push({ node: def.node.id, name: variable.name });
          }
        }
        const allowed = baseline[file] ?? 0;
        if (offenders.length > allowed) {
          if (allowed === 0) for (const o of offenders) context.report({ node: o.node, messageId: 'missing', data: { name: o.name } });
          else context.report({ node: program, messageId: 'over', data: { file, count: offenders.length, allowed } });
        } else if (offenders.length < allowed) {
          context.report({ node: program, messageId: 'stale', data: { file, count: offenders.length, allowed } });
        }
      },
    };
  },
};

export default { rules: { 'query-handles-error': rule } };
