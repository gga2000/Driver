/// <reference types="vitest/config" />
/**
 * One Vite config for the web gallery (`pnpm --filter @driver/ui gallery`) and the component
 * tests (`vitest`). `react-native` resolves to `react-native-web`, `.web.*` files win, and the
 * Reanimated Babel plugin turns our worklets into web-runnable functions — the same component
 * source the Expo apps bundle with Metro.
 */
import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import react from '@vitejs/plugin-react';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

const webExtensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.mjs', '.web.js', '.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'];
const rnPackages = ['react-native-web', 'react-native-reanimated', 'react-native-svg', 'react-native-gesture-handler'];

/**
 * Reanimated and Gesture Handler reach for optional peers with `require()` inside ESM files,
 * which Rollup leaves as a throwing call — so Reanimated can't style DOM nodes and RNGH can't see
 * Reanimated. Rewrite those two modules as static ESM imports.
 */
function rnWebInterop(): Plugin {
  return {
    name: 'driver-rn-web-interop',
    enforce: 'pre',
    transform(code, id) {
      // (Reanimated 3.17 moved it under ReanimatedModule/.)
      if (/react-native-reanimated[\\/]lib[\\/]module[\\/](ReanimatedModule[\\/])?js-reanimated[\\/]webUtils\.web\.js$/.test(id)) {
        return [
          "import _createReactDOMStyle from 'react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle';",
          "import { createTransformValue as _t, createTextShadowValue as _s } from 'react-native-web/dist/exports/StyleSheet/preprocess';",
          'export const createReactDOMStyle = _createReactDOMStyle;',
          'export const createTransformValue = _t;',
          'export const createTextShadowValue = _s;',
        ].join('\n');
      }
      if (/react-native-gesture-handler[\\/]lib[\\/]module[\\/]handlers[\\/]gestures[\\/]reanimatedWrapper\.js$/.test(id)) {
        return code
          .replace("Reanimated = require('react-native-reanimated');", 'Reanimated = { ..._ReanimatedModule, ..._ReanimatedModule.default };')
          .replace("import { tagMessage } from '../../utils';", "import { tagMessage } from '../../utils';\nimport * as _ReanimatedModule from 'react-native-reanimated';");
      }
      return null;
    },
  };
}

/**
 * Some React Native libraries publish JSX inside plain `.js` files (Reanimated ≥ 3.17's
 * `lib/module`). Metro's Babel takes it; Vite needs it compiled before import analysis.
 */
function jsxInRnLibraries(): Plugin {
  const lib = /node_modules[\\/](react-native-[\w-]+)[\\/]lib[\\/]module[\\/].*\.js$/;
  return {
    name: 'driver-rn-jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!lib.test(id) || !/<[A-Za-z>]/.test(code)) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  };
}

/**
 * Reanimated 4 checks in development that its own `'worklet'` functions went through the worklets
 * Babel plugin. Metro runs that plugin over node_modules; Vite only over our source, so run it over
 * react-native-worklets and react-native-reanimated here. Tests and the dev server only: a production
 * gallery build has no development checks (and Babel over these libraries is slow).
 */
function workletsInRnLibraries(): Plugin {
  const lib = /node_modules[\\/]react-native-(worklets|reanimated)[\\/]lib[\\/]module[\\/].*\.js$/;
  return {
    name: 'driver-rn-worklets-in-libraries',
    apply: 'serve',
    async transform(code, id) {
      if (!lib.test(id) || !code.includes("'worklet'")) return null;
      const out = await transformAsync(code, { filename: id, babelrc: false, configFile: false, sourceMaps: true, plugins: ['react-native-worklets/plugin'] });
      return out?.code ? { code: out.code, map: out.map } : null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('./gallery', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [
    rnWebInterop(),
    jsxInRnLibraries(),
    workletsInRnLibraries(),
    react({
      babel: { plugins: ['react-native-worklets/plugin'] },
    }),
  ],
  define: {
    __DEV__: JSON.stringify(mode !== 'production'),
    'process.env.NODE_ENV': JSON.stringify(mode === 'test' ? 'test' : mode),
    'process.env.JEST_WORKER_ID': 'undefined',
    global: 'globalThis',
  },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      // react-native-svg's web image helper reaches for Metro's (Flow-typed) asset registry.
      { find: /^@react-native\/assets-registry\/registry$/, replacement: 'react-native-web/dist/modules/AssetRegistry' },
      // Vitest resolves `main` (CommonJS, untransformed `require('react-native')`); use the ESM build.
      { find: /^react-native-svg$/, replacement: fileURLToPath(new URL('./node_modules/react-native-svg/lib/module/index.js', import.meta.url)) },
      { find: /^react-native-gesture-handler$/, replacement: fileURLToPath(new URL('./node_modules/react-native-gesture-handler/lib/module/index.js', import.meta.url)) },
      { find: /^react-native-safe-area-context$/, replacement: fileURLToPath(new URL('./node_modules/react-native-safe-area-context/lib/module/index.js', import.meta.url)) },
    ],
    extensions: webExtensions,
  },
  optimizeDeps: {
    include: rnPackages,
    esbuildOptions: {
      resolveExtensions: webExtensions,
      loader: { '.js': 'jsx' },
      define: { global: 'globalThis', __DEV__: 'false' },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./gallery-dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: [/react-native/, /@react-native/, /@driver\//] } },
  },
}));
