import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import driver from './eslint-rules/query-states.mjs';

export default tseslint.config(
  { ignores: ['eslint-rules/**', 'dist-web/**', 'dist-web-*/**', 'web-shots/**', 'node_modules/**', '.expo/**', 'expo-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Screens: every query read needs an error state (QueryBoundary or isError); see the rule's header.
    files: ['app/**/*.tsx'],
    plugins: { driver },
    rules: { 'driver/query-handles-error': 'error' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', URL: 'readonly', console: 'readonly', document: 'readonly', getComputedStyle: 'readonly', localStorage: 'readonly', fetch: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly' },
    },
  },
);
