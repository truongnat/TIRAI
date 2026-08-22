import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // ── Correctness ──────────────────────────────────────────────────
      'no-var': 'error',
      'no-constant-binary-expression': 'error',
      'no-constructor-return': 'error',
      'no-duplicate-imports': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      'arrow-body-style': ['error', 'as-needed'],

      // ── TypeScript (non-type-aware) ──────────────────────────────────
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-generic-constructors': ['error', 'constructor'],
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],

      // ── Style ────────────────────────────────────────────────────────
      'prefer-const': 'error',
      'eqeqeq': 'error',
      'no-console': 'warn',

      // ── Relaxations ──────────────────────────────────────────────────
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
);
