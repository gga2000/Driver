import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildMapStyle } from './style.js';

/**
 * Build step: writes `dist/style.json` (the raster-fallback style) for tools that want a plain
 * style URL. The source of truth stays `buildMapStyle()`; never hand-edit the JSON.
 */
const out = fileURLToPath(new URL('./style.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(buildMapStyle(), null, 2)}\n`);
console.log(`wrote ${out}`);
