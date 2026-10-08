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
 *
 * The partner app reuses it (`writePartnerLocales`, speed s1 for the courier app): it drops the Console's and
 * the server's namespaces the same way, plus every namespace that neither its code nor the shared packages it
 * runs ever name (the customer app's food, checkout, home…), keeping the keys it does name.
 */

const PLURAL = /_(zero|one|two|few|many|other)$/;
const SOURCE = /\.(tsx?|mjs|cjs|js)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'dist-web', 'e2e', 'scripts', 'gallery']);
const SHARED_ROOTS = ['packages/ui/src', 'packages/contracts/src', 'packages/map/src', 'packages/i18n/src'];
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

const namespaceOf = (key) => key.split(/[.:]/)[0];

function pickMessages(messages, refs, drop = DROP) {
  const prefixes = [...refs.prefixes];
  const keep = (key) =>
    !drop.has(namespaceOf(key)) || refs.exact.has(key) || refs.exact.has(key.replace(PLURAL, '')) || prefixes.some((p) => key.startsWith(p));
  return Object.fromEntries(Object.entries(messages).filter(([key]) => keep(key)));
}

/** The namespaces an app drops: `always`, plus (with `unnamed`) every namespace its code never names at all. */
function dropFor(messages, refs, always, unnamed) {
  const drop = new Set(always);
  if (!unnamed) return drop;
  const named = new Set([...refs.exact, ...refs.prefixes].map(namespaceOf));
  for (const key of Object.keys(messages)) if (!named.has(namespaceOf(key))) drop.add(namespaceOf(key));
  return drop;
}

function writeLocales({ repoRoot, outDir, roots, always, unnamed }) {
  const refs = { exact: new Set(), prefixes: new Set() };
  for (const root of roots) walk(path.join(repoRoot, root), refs);
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  for (const locale of LOCALES) {
    const all = JSON.parse(fs.readFileSync(path.join(repoRoot, `packages/i18n/src/locales/${locale}.json`), 'utf8'));
    out[locale] = path.join(outDir, `${locale}.json`);
    fs.writeFileSync(out[locale], JSON.stringify(pickMessages(all, refs, dropFor(all, refs, always, unnamed))));
  }
  return out;
}

/** Writes the subset tables under `outDir` once per Metro start; returns `{ 'ar-IQ': path, en: path }`. */
function writeCustomerLocales({ repoRoot, outDir }) {
  return writeLocales({ repoRoot, outDir, roots: ROOTS, always: DROP, unnamed: false });
}

/** The partner app's tables: no Console, WhatsApp or SMS texts, and none of the customer-only screens. */
const PARTNER_ROOTS = ['apps/partner/app', 'apps/partner/src', ...SHARED_ROOTS];
const PARTNER_DROP = new Set(['console', 'wa', 'sms']);
function writePartnerLocales({ repoRoot, outDir }) {
  return writeLocales({ repoRoot, outDir, roots: PARTNER_ROOTS, always: PARTNER_DROP, unnamed: true });
}

module.exports = { keyRefs, pickMessages, dropFor, writeCustomerLocales, writePartnerLocales };
