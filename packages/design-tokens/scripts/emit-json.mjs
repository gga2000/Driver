// Emits tokens.json from the TypeScript source of truth so non-TS consumers
// (Tailwind config, native theme files, design tools) read the same values.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tokens } from '../dist/tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, '../tokens.json'), JSON.stringify(tokens, null, 2) + '\n');
