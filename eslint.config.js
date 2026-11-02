import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '.agents/**', '.taste-skill/**', 'video/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } } },
);
