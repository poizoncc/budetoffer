import neostandard from 'neostandard';
import globals from 'globals';
import type {Linter} from 'eslint';

const browserFiles = ['apps/chrome-companion/**/*.{ts,tsx}', 'apps/ui-layer/src/pages/companion-popup/**/*.{ts,tsx}'];
const nodeFiles = ['apps/chrome-companion/vite.config.ts', 'scripts/build.ts', 'scripts/package-companion.ts'];
const sourceFiles = [...browserFiles, ...nodeFiles];
const ignored = ['**/*.test.{ts,tsx}', '**/node_modules/**', '**/dist/**', '**/build/**', '**/vendor/**', '**/input/**', '**/data/**'];

// Keep the existing repository formatting. This gate checks code quality and
// typed boundaries; tsc separately verifies runtime, UI and build scripts.
const standard = neostandard({ts: true, noStyle: true}).map(config => ({
  ...config,
  files: sourceFiles,
  languageOptions: {...config.languageOptions, globals: globals.es2022},
}));

export default [
  {ignores: ignored},
  ...standard,
  {
    files: sourceFiles,
    linterOptions: {reportUnusedDisableDirectives: 'error', noInlineConfig: true},
    rules: {
      'no-void': ['error', {allowAsStatement: true}],
      'no-labels': ['error', {allowLoop: true}],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {'ts-check': false, 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true}],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true}],
      '@typescript-eslint/consistent-type-imports': ['error', {prefer: 'type-imports'}],
    },
  },
  {files: browserFiles, ignores: nodeFiles, languageOptions: {globals: {...globals.browser, ...globals.webextensions}}},
  {files: nodeFiles, languageOptions: {globals: globals.node}},
] satisfies Linter.Config[];
