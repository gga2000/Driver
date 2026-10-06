#!/usr/bin/env node
// Finishes an `expo export --platform web` folder for a static host (docs/deploy/web.md):
//
//   node scripts/deploy/prepare-web.mjs apps/customer/dist-web [--api-url https://api.example.com/trpc] [--serve 8080]
//
// - checks index.html is there and that the API URL was inlined into the bundle (EXPO_PUBLIC_API_URL is
//   read at build time: a bundle built without it would call http://localhost:3000 from users' phones);
// - writes `_headers` (Cloudflare Pages / Netlify syntax): hashed bundles cached for a year, the HTML
//   never, security headers everywhere, and /share/* (public trip links) kept out of search engines;
// - leaves no 404.html, so Cloudflare Pages serves index.html for every unknown path (SPA fallback) —
//   that is what makes deep links such as /share/<token> work;
// - writes `invite.html` (index.html with the invite link's preview card: title, description and
//   `og:image` = <base>/invite-card.png, words from the Arabic locale) and `_redirects` so `/i/<code>`
//   (joy g2) is served from it — WhatsApp shows the card when someone sends an invitation; the app
//   itself boots the same and opens the landing page. Base: `--base-url` or EXPO_PUBLIC_SHARE_BASE_URL;
// - `--serve <port>`: serves the folder locally with the same fallback, to try it before deploying.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apiUrl = flag('--api-url') ?? process.env.EXPO_PUBLIC_API_URL;
const baseUrl = (flag('--base-url') ?? process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').replace(/\/$/, '');
const servePort = flag('--serve');

if (!dir) {
  console.error('usage: node scripts/deploy/prepare-web.mjs <dist-web folder> [--api-url <url>] [--serve <port>]');
  process.exit(2);
}
const root = resolve(dir);
const fail = (msg) => {
  console.error(`✘ ${msg}`);
  process.exit(1);
};

if (!existsSync(join(root, 'index.html'))) fail(`${root}/index.html not found — run the app's web:export first`);
if (existsSync(join(root, '404.html'))) fail('404.html present: Cloudflare Pages would stop serving index.html for deep links (/share/…)');

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}
const bundles = [...files(root)].filter((p) => p.endsWith('.js'));
if (bundles.length === 0) fail('no JavaScript bundle in the export');
if (apiUrl) {
  if (/localhost|127\.0\.0\.1/.test(apiUrl) && !servePort) fail(`API URL ${apiUrl} points at this computer; set EXPO_PUBLIC_API_URL to the public API`);
  const found = bundles.some((p) => readFileSync(p, 'utf8').includes(apiUrl));
  if (!found) fail(`the bundle does not contain ${apiUrl}: build with EXPO_PUBLIC_API_URL=${apiUrl}`);
  console.log(`✔ bundle calls ${apiUrl}`);
} else {
  console.log('! no --api-url / EXPO_PUBLIC_API_URL given: not checking which API the bundle calls');
}

const HEADERS = `# Written by scripts/deploy/prepare-web.mjs (docs/deploy/web.md). Cloudflare Pages / Netlify syntax.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(self), camera=(self), microphone=()

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/share/*
  Cache-Control: no-cache
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer

/i/*
  Cache-Control: no-cache
  X-Robots-Tag: noindex, nofollow

/invite.html
  Cache-Control: no-cache
`;
writeFileSync(join(root, '_headers'), HEADERS);
console.log(`✔ wrote ${join(dir, '_headers')}`);

// Invite links (joy g2): the same app, with a preview card WhatsApp can read before anyone signs in.
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ar = JSON.parse(readFileSync(new URL('../../packages/i18n/src/locales/ar-IQ.json', import.meta.url), 'utf8'));
const ogTitle = escapeHtml(ar['invite.landing_title_anon']);
const ogBody = escapeHtml(ar['invite.landing_body']);
const ogImage = existsSync(join(root, 'invite-card.png')) ? `${baseUrl}/invite-card.png` : null;
const ogTags = [
  `<meta property="og:title" content="${ogTitle}" />`,
  `<meta property="og:description" content="${ogBody}" />`,
  '<meta property="og:type" content="website" />',
  '<meta property="og:locale" content="ar_IQ" />',
  ...(ogImage ? [`<meta property="og:image" content="${ogImage}" />`, '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />'] : []),
  '<meta name="twitter:card" content="summary_large_image" />',
].join('\n    ');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
writeFileSync(join(root, 'invite.html'), indexHtml.replace('</head>', `    ${ogTags}\n  </head>`));
writeFileSync(join(root, '_redirects'), '# Written by scripts/deploy/prepare-web.mjs: invite links get the page with the preview card.\n/i/*  /invite.html  200\n');
if (!baseUrl) console.log('! no --base-url / EXPO_PUBLIC_SHARE_BASE_URL: the invite card image link is relative (WhatsApp needs an absolute one)');
console.log(`✔ wrote invite.html${ogImage ? ' with its preview card' : ' (no invite-card.png in the export: no image on the card)'} and _redirects (/i/* → invite.html)`);
console.log(`✔ ${bundles.length} bundle(s), SPA fallback on (no 404.html) — ready to upload ${dir}`);

if (servePort) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, path.startsWith('/i/') ? 'invite.html' : 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }).listen(Number(servePort), () => console.log(`serving ${dir} on http://localhost:${servePort} (every unknown path → index.html)`));
}
