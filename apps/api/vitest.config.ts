import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps Nest's decorator metadata (emitDecoratorMetadata) which esbuild drops.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], testTimeout: 15_000 },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
