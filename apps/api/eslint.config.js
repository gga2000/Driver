import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Module boundary rule (spec §4): a module exposes a public interface through its index.ts.
 * No module may import another module's internals — only `../<module>` or `../<module>/index`.
 */
export default tseslint.config(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Resolve `./x.js` specifiers (NodeNext) back to their .ts sources.
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*', mode: 'folder', capture: ['name'] },
        { type: 'shared', pattern: 'src/shared/*', mode: 'full' },
        { type: 'trpc', pattern: 'src/trpc/*', mode: 'full' },
        { type: 'root', pattern: 'src/*', mode: 'full' },
      ],
    },
    rules: {
      'boundaries/no-private': 'off',
      // Allow modules to reach each other only through their public entry (index.ts).
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['module'], allow: 'index.ts' },
            { target: ['shared', 'trpc', 'root'], allow: '*' },
          ],
        },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            // shared code must stay free of module knowledge
            { from: ['shared'], disallow: ['module', 'root', 'trpc'] },
            // modules never import the composition root or the transport layer
            { from: ['module'], disallow: ['root', 'trpc'] },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests may reach into their own module's internals.
    files: ['src/**/*.test.ts'],
    rules: { 'boundaries/entry-point': 'off' },
  },
);
