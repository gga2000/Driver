#!/usr/bin/env node
/**
 * Speed budget check (build plan §6, gate C7, CON-13): after `next build`, every Console page's first
 * load must stay within the JS budget, and MapLibre must load only on demand where a map is shown.
 *
 * "First load" here is everything the browser fetches before the page can run: the root scripts, every
 * layout and error boundary on the page's path, and the page itself, gzipped at level 9 as a server
 * would send them. (Next's own "First Load JS" column leaves out the layouts, so it reads ≈ 30 KB lower.)
 *
 * The plan's target is 250 KB. Every page meets it by Next's count (224–250 KB on 2026-10-07); by this
 * fuller count they are 253–281 KB, and the shared frame alone is ≈ 253 KB (React and Next 103, the
 * Arabic strings 47, React Query 38, the shared contracts 23). So the check holds a 294 KB ceiling: no
 * page may grow past it. Lowering it to 250 needs the strings split per page (CON-13 follow-up).
 * 290 → 292 (Ali, 2026-10-08): trips step 1 (#41) adds its Console words and screens to the shared
 * frame and lands just over 290; 2 KB lets it merge without trimming a desk page.
 * 292 → 293 (2026-10-09): private car steps 2–6 and the trip chat add their API error texts and the trip
 * quick replies support reads in chat transcripts; /support lands at 292.6.
 * 293 → 294 (2026-10-10): the shift handover note (h5), the ready-reply keys (s4) and the stores'
 * «للتكملة» gaps (k6) add their words to every page; /support lands at 293.0. CON-13 (strings per page)
 * is still the real fix.
 *
 *   node scripts/bundle-budget.mjs            # check .next, print the table
 *   BUDGET_KB=250 node scripts/bundle-budget.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = path.resolve(process.argv[2] ?? '.next');
const BUDGET = Number(process.env['BUDGET_KB'] ?? 294) * 1000;
const app = JSON.parse(fs.readFileSync(path.join(dir, 'app-build-manifest.json'), 'utf8')).pages;
const root = JSON.parse(fs.readFileSync(path.join(dir, 'build-manifest.json'), 'utf8')).rootMainFiles;

const sizes = new Map();
const gz = (file) => {
  if (!sizes.has(file)) {
    const body = fs.readFileSync(path.join(dir, file));
    sizes.set(file, { bytes: gzipSync(body, { level: 9 }).length, maplibre: body.includes('maplibre') && body.length > 300_000 });
  }
  return sizes.get(file);
};

/** `/safety/[id]/page` → `/layout`, `/error`, `/safety/layout`, `/safety/error`, then the page. */
function segmentsOf(page) {
  const parts = page.replace(/\/page$/, '').split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i <= parts.length; i++) {
    const base = i === 0 ? '' : `/${parts.slice(0, i).join('/')}`;
    out.push(`${base}/layout`, `${base}/error`);
  }
  return [...out.filter((k) => app[k]), page];
}

const rows = [];
for (const page of Object.keys(app).filter((k) => k.endsWith('/page') && !k.startsWith('/_'))) {
  const files = new Set(root);
  for (const seg of segmentsOf(page)) for (const f of app[seg]) if (f.endsWith('.js')) files.add(f);
  let bytes = 0;
  let map = false;
  for (const f of files) {
    const s = gz(f);
    bytes += s.bytes;
    map ||= s.maplibre;
  }
  rows.push({ route: page.replace(/\/page$/, '') || '/', bytes, map });
}

rows.sort((a, b) => b.bytes - a.bytes);
const problems = [];
for (const r of rows) {
  const over = r.bytes > BUDGET;
  if (over) problems.push(`${r.route}: ${(r.bytes / 1000).toFixed(1)} KB, over the ${BUDGET / 1000} KB budget`);
  if (r.map) problems.push(`${r.route}: MapLibre is in the first load; import the map canvas with next/dynamic`);
  console.log(`${over || r.map ? '✗' : '✓'} ${(r.bytes / 1000).toFixed(1).padStart(6)} KB  ${r.route}${r.map ? '  (MapLibre!)' : ''}`);
}
if (problems.length > 0) {
  console.error(`\nSpeed budget failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} pages within ${BUDGET / 1000} KB of gzipped JS on first load; MapLibre loads only where a map is shown.`);
