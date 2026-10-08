/* eslint-disable */
const fs = require('node:fs');
const path = require('node:path');

/**
 * The customer app's copy of the strings (speed s1). `@driver/i18n` holds every app's strings (customer,
 * partner, Console, server messages) in both languages, about 1 MB, and the app carried all of it. A
 * production build (metro.config.js) swaps in tables without the other apps' namespaces (`DROP`: the
 * Console's and the partner app's screens, the server's WhatsApp and SMS texts), about two thirds of the
 * tables. Every customer namespace stays whole, so a key built at run time can never go missing; a key in
 * a dropped namespace stays too when this app's code (or a shared package it runs) names it, whole or as
 * a prefix (`` `partner.vehicle_${v}` ``), as in the Console's `scripts/locale-subset.mjs`. Dev builds keep
 * the full tables.
 */

const PLURAL = /_(zero|one|two|few|many|other)$/;
const SOURCE = /\.(tsx?|mjs|cjs|js)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'dist-web', 'e2e', 'scripts', 'gallery']);
const ROOTS = ['apps/customer/app', 'apps/customer/src', 'packages/ui/src', 'packages/contracts/src', 'packages/map/src', 'packages/i18n/src'];
const LOCALES = ['ar-IQ', 'en'];
/** Namespaces only other apps (or the server) show. */
const DROP = new Set(['console', 'partner', 'wa', 'sms']);

function keyRefs(source, into) {
  for (const m of source.matchAll(/(['"`])([a-z_]+[.:][\w.:-]*)(.)/g)) {
    const [, open, key, next] = m;
    const whole = next === open && !/[.:_-]$/.test(key);
    (whole ? into.exact : into.prefixes).add(key);
  }
  return into;
}

function walk(dir, refs) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(p, refs);
    } else if (SOURCE.test(entry.name) && !entry.name.includes('.test.')) {
      keyRefs(fs.readFileSync(p, 'utf8'), refs);
    }
  }
  return refs;
}

function pickMessages(messages, refs) {
  const prefixes = [...refs.prefixes];
  const keep = (key) =>
    !DROP.has(key.split(/[.:]/)[0]) || refs.exact.has(key) || refs.exact.has(key.replace(PLURAL, '')) || prefixes.some((p) => key.startsWith(p));
  return Object.fromEntries(Object.entries(messages).filter(([key]) => keep(key)));
}

/** Writes the subset tables under `outDir` once per Metro start; returns `{ 'ar-IQ': path, en: path }`. */
function writeCustomerLocales({ repoRoot, outDir }) {
  const refs = { exact: new Set(), prefixes: new Set() };
  for (const root of ROOTS) walk(path.join(repoRoot, root), refs);
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  for (const locale of LOCALES) {
    const all = JSON.parse(fs.readFileSync(path.join(repoRoot, `packages/i18n/src/locales/${locale}.json`), 'utf8'));
    out[locale] = path.join(outDir, `${locale}.json`);
    fs.writeFileSync(out[locale], JSON.stringify(pickMessages(all, refs)));
  }
  return out;
}

module.exports = { keyRefs, pickMessages, writeCustomerLocales };
