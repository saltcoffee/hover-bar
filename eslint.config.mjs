import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['main.js', 'node_modules/**', 'docs/**', 'test-vault/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } } },
  { rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
