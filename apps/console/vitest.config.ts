import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pure helpers (`*.test.ts`) and page smoke tests (`*.test.tsx`, server-rendered with react-dom/server).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
