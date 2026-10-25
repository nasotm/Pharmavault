import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.opfs/**', '.playwright-cli/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/sqlite-wasm-adapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sqlite.org/sqlite-wasm',
              message:
                'Direct access to @sqlite.org/sqlite-wasm is forbidden outside SqliteWasmAdapter (src/db/sqlite-wasm-adapter.ts). Use DatabasePort or the repository module.',
            },
          ],
        },
      ],
    },
  },
);
