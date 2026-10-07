// Turns the Date & Saffron dish pictures (hand-written SVG, viewBox 240) into react-native-svg components
// in src/art/dish-pictures.tsx: Ali's 27 locked ones (illustrations/dishes) and the ones drawn after them
// in the same style for the dishes the locked set doesn't cover (illustrations/dishes-new). The pictures are not redrawn: only the metadata is dropped,
// numbers keep their digits, and lines and dots of one colour are joined into one path where that draws the
// same picture, which keeps a thumbnail cheap.
//   node packages/ui/scripts/import-dish-pictures.mjs /mnt/project-files/illustrations/dishes /mnt/project-files/illustrations/dishes-new
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A tiny parser for these hand-written files: elements and attributes only (no text, no CDATA). */
function parse(text) {
  const root = { tagName: '#root', children: [], attrs: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w:]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  for (const m of text.matchAll(re)) {
    if (!m[2]) continue;
    const [, close, tag, rawAttrs, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const el = { tagName: tag, children: [], attrs: [...rawAttrs.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1], a[2]]) };
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  return root.children[0];
}
const get = (el, n) => el.attrs.find(([k]) => k === n)?.[1] ?? null;

const [locked, added] = process.argv.slice(2);
if (!locked || !added) throw new Error('usage: import-dish-pictures.mjs <locked dir> <added dir>');
const out = fileURLToPath(new URL('../src/art/dish-pictures.tsx', import.meta.url));

const TAGS = {
  g: 'G', path: 'Path', circle: 'Circle', ellipse: 'Ellipse', rect: 'Rect', line: 'Line', polygon: 'Polygon',
  defs: 'Defs', linearGradient: 'LinearGradient', radialGradient: 'RadialGradient', stop: 'Stop', clipPath: 'ClipPath', use: 'Use',
};
const camel = (a) => (a === 'xlink:href' ? 'href' : a.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
const used = new Set();

function attrs(el) {
  return el.attrs.filter(([n]) => !n.startsWith('xmlns')).map(([n, v]) => [camel(n), v]);
}

/** A path that is one straight stroke (no area): safe to join with its twins. */
const isStroke = (el) => el.tagName === 'path' && /^M[\d.\s-]+L[\d.\s-]+$/.test(get(el, 'd') ?? '') && !get(el, 'fill') && (get(el, 'opacity') ?? '1') === '1';
/** A solid-filled dot (seeds, sesame, chickpeas): joins its twins as arcs of one path. */
const isDot = (el) =>
  (el.tagName === 'circle' || el.tagName === 'ellipse') && !/url\(/.test(get(el, 'fill') ?? '') && !get(el, 'transform') && (get(el, 'opacity') ?? '1') === '1' && !get(el, 'fill-opacity');
const GEOMETRY = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'd']);
function dotPath(el) {
  const cx = +get(el, 'cx'), cy = +get(el, 'cy');
  const rx = +(get(el, 'r') ?? get(el, 'rx')), ry = +(get(el, 'r') ?? get(el, 'ry'));
  const n = (v) => +v.toFixed(2);
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0z`;
}
/** The area a line or dot paints, padded by half its stroke. */
function boxOf(el) {
  const pad = (+(get(el, 'stroke-width') ?? 0)) / 2 + 0.5;
  if (el.tagName === 'path') {
    const n = (get(el, 'd') ?? '').match(/-?[\d.]+/g).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  }
  const cx = +get(el, 'cx'), cy = +get(el, 'cy');
  const rx = +(get(el, 'r') ?? get(el, 'rx')) + pad, ry = +(get(el, 'r') ?? get(el, 'ry')) + pad;
  return [cx - rx, cy - ry, cx + rx, cy + ry];
}
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const styleKey = (el) => attrs(el).filter(([k]) => !GEOMETRY.has(k)).map(([k, v]) => `${k}=${v}`).sort().join('|');

function children(el) {
  const kids = el.children.filter((n) => n.tagName !== 'metadata');
  // A run of one-stroke lines (rice grains, sesame) and solid dots is drawn as one path per colour. A
  // piece joins an earlier path only when it touches nothing drawn in between, so the picture is the same.
  const merged = [];
  let run = null;
  for (const k of kids) {
    const dot = isDot(k);
    if (!isStroke(k) && !dot) {
      run = null;
      merged.push({ el: k });
      continue;
    }
    run ??= { items: [], drawn: [] };
    const key = (dot ? 'dot|' : 'line|') + styleKey(k);
    const box = boxOf(k);
    const same = [...run.items].reverse().find((it) => it.key === key);
    const clear = same && run.drawn.slice(same.at).every((o) => o.key === key || !overlaps(o.box, box));
    const d = dot ? dotPath(k) : get(k, 'd');
    if (same && clear) same.d.push(d);
    else {
      const item = { stroke: true, dot, key, el: k, d: [d], at: run.drawn.length };
      run.items.push(item);
      merged.push(item);
    }
    run.drawn.push({ key, box });
  }
  return merged;
}

function jsx(item, pad) {
  const el = item.el;
  if (item.stroke && (item.dot ? item.d.length > 1 : true)) {
    used.add('Path');
    const style = attrs(el).filter(([k]) => !GEOMETRY.has(k));
    return `${pad}<Path d=${JSON.stringify(item.d.join(''))}${style.map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('')} />`;
  }
  const tag = TAGS[el.tagName];
  if (!tag) throw new Error(`unsupported <${el.tagName}>`);
  used.add(tag);
  const props = attrs(el);
  const p = props.map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('');
  const kids = children(el);
  if (kids.length === 0) return `${pad}<${tag}${p} />`;
  return `${pad}<${tag}${p}>\n${kids.map((k) => jsx(k, pad + '  ')).join('\n')}\n${pad}</${tag}>`;
}

const files = [locked, added].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.svg')).sort().map((f) => ({ dir, f })));
const lockedNames = files.filter((x) => x.dir === locked).map((x) => basename(x.f, '.svg'));
const blocks = files.map(({ dir, f }) => {
  const name = basename(f, '.svg');
  const text = readFileSync(join(dir, f), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  const svg = parse(text);
  if (get(svg, 'viewBox') !== '0 0 240 240') throw new Error(`${f}: viewBox must be 0 0 240 240`);
  const body = children(svg).map((k) => jsx(k, '    ')).join('\n');
  return `  '${name}': () => (\n    <G>\n${body}\n    </G>\n  ),`;
});

writeFileSync(
  out,
  `/* eslint-disable */
// Generated by packages/ui/scripts/import-dish-pictures.mjs: never edit by hand. The Date & Saffron dish
// pictures, each in a 240 × 240 box. The ones in LOCKED_DISH_PICTURES are Ali's (approved 2026-10-07, "keep
// them locked"): redraw or restyle them only when he asks. The rest were drawn after them, in the same style.
import type { ReactElement } from 'react';
import { ${[...used, 'G'].filter((v, i, a) => a.indexOf(v) === i).sort().join(', ')} } from 'react-native-svg';

export const DISH_PICTURES = {
${blocks.join('\n')}
} satisfies Record<string, () => ReactElement>;

export type DishPictureName = keyof typeof DISH_PICTURES;

export const LOCKED_DISH_PICTURES: readonly DishPictureName[] = ${JSON.stringify(lockedNames)};
`,
);
console.log(`wrote ${files.length} pictures to ${out}`);
