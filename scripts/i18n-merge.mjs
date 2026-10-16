#!/usr/bin/env node
// Git merge driver for packages/i18n/src/locales/*.json (flat { "key": "string" } files).
// Set up by .gitattributes (`merge=i18n-json`) and, in every fresh clone, by the SessionStart hook in
// .claude/settings.json:
//   git config merge.i18n-json.driver "node scripts/i18n-merge.mjs %O %A %B"
// Usage: node scripts/i18n-merge.mjs <ancestor %O> <ours %A> <theirs %B>; the result is written to %A.
//
// Per key, a three-way merge:
//   - both sides agree (same value, or both deleted) → that;
//   - only one side changed it from the ancestor (added, edited or deleted) → that side's change;
//   - both changed it to different things (including edit vs delete) → a conflict. The driver exits 1,
//     lists the keys, and writes git-style <<<<<<< / ======= / >>>>>>> markers around those entries so
//     the file cannot be parsed (and tests fail) until someone picks a value.
//
// Key order (the files are grouped by feature, not sorted; plan §3.2 asked for "sorted", but sorting
// would rewrite thousands of lines, so the existing order is kept): the result keeps OUR key order, and
// every key that only THEIR side has goes right after the key that precedes it on their side (or at the
// top when nothing does), after any keys our side added at that same spot. So a key added in the middle of a group lands in that group, and a merge adds
// exactly the lines each side added. Output: 2-space indent and a trailing newline, as the files use.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of flat JSON objects. Returns { entries: [key, value | {conflict}][], conflicts: string[] }.
 * For a conflict, value is { conflict: { ours, theirs } } (either may be undefined = deleted).
 */
export function mergeLocales(base, ours, theirs) {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const get = (o, k) => (has(o, k) ? o[k] : undefined);
  const result = new Map();
  const conflicts = [];
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)]);
  for (const k of keys) {
    const o = get(base, k);
    const a = get(ours, k);
    const b = get(theirs, k);
    let value;
    if (same(a, b)) value = a;
    else if (same(a, o)) value = b;
    else if (same(b, o)) value = a;
    else {
      conflicts.push(k);
      result.set(k, { conflict: { ours: a, theirs: b } });
      continue;
    }
    if (value !== undefined) result.set(k, value);
  }

  // Order: ours first, then theirs-only keys after their predecessor on their side.
  const order = Object.keys(ours).filter((k) => result.has(k));
  const placed = new Set(order);
  let prev = null;
  for (const k of Object.keys(theirs)) {
    if (!result.has(k)) continue;
    if (!placed.has(k)) {
      // Right after the predecessor, past any keys only our side added there (ours first, then theirs).
      let at = prev === null ? 0 : order.indexOf(prev) + 1;
      while (at < order.length && !has(theirs, order[at])) at += 1;
      order.splice(at, 0, k);
      placed.add(k);
    }
    prev = k;
  }
  // Keys only the ancestor had can only survive as conflicts (one side deleted, the other edited).
  for (const k of result.keys()) if (!placed.has(k)) order.push(k);

  return { entries: order.map((k) => [k, result.get(k)]), conflicts };
}

const line = (k, v, comma) => `  ${JSON.stringify(k)}: ${JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')}${comma}`;

/** Serialise merged entries the way the locale files are written (2-space indent, trailing newline). */
export function formatEntries(entries) {
  const out = ['{'];
  entries.forEach(([k, v], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (v && typeof v === 'object' && 'conflict' in v) {
      out.push('<<<<<<< ours');
      if (v.conflict.ours !== undefined) out.push(line(k, v.conflict.ours, comma));
      else out.push(`  // ${JSON.stringify(k)} deleted on this side`);
      out.push('=======');
      if (v.conflict.theirs !== undefined) out.push(line(k, v.conflict.theirs, comma));
      else out.push(`  // ${JSON.stringify(k)} deleted on this side`);
      out.push('>>>>>>> theirs');
    } else {
      out.push(line(k, v, comma));
    }
  });
  out.push('}');
  return `${out.join('\n')}\n`;
}

function readJson(path) {
  const text = readFileSync(path, 'utf8');
  return text.trim() === '' ? {} : JSON.parse(text);
}

function main([basePath, oursPath, theirsPath]) {
  if (!basePath || !oursPath || !theirsPath) {
    console.error('usage: node scripts/i18n-merge.mjs <ancestor %O> <ours %A> <theirs %B>');
    return 2;
  }
  let base, ours, theirs;
  try {
    [base, ours, theirs] = [readJson(basePath), readJson(oursPath), readJson(theirsPath)];
  } catch (err) {
    console.error(`i18n-merge: a side is not valid JSON (${err.message}); resolve this file by hand.`);
    return 1;
  }
  const { entries, conflicts } = mergeLocales(base, ours, theirs);
  writeFileSync(oursPath, formatEntries(entries));
  if (conflicts.length > 0) {
    console.error(`i18n-merge: ${conflicts.length} key(s) were changed differently on both sides; pick one value for each (look for <<<<<<<):`);
    for (const k of conflicts) console.error(`  - ${k}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
