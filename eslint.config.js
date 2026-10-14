// @ts-check
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config.
 *
 * Enforces run.md §22.7: argument arrays only for subprocesses.
 * The `no-restricted-syntax` entries forbid the string-form overloads of
 * child_process.exec / execSync / spawnSync and `shell: true` options.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'schemas/**',
      'pnpm-lock.yaml',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='exec']",
          message:
            'child_process.exec is forbidden (run.md §22.7). Use execa with an argument array.',
        },
        {
          selector: "CallExpression[callee.property.name='execSync']",
          message:
            'child_process.execSync is forbidden (run.md §22.7). Use execa with an argument array.',
        },
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message:
            "shell: true is forbidden (run.md §22.7). Use argument arrays with explicit binaries.",
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
