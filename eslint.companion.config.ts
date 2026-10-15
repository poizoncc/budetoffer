import neostandard from "neostandard";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import type { Linter } from "eslint";

const browserFiles = [
  "apps/chrome-companion/**/*.{ts,tsx}",
  "apps/ui-layer/src/**/*.{ts,tsx}",
];
const nodeFiles = [
  "scripts/**/*.ts",
  "*.config.ts",
  "apps/chrome-companion/vite.config.ts",
];
const testFiles = [
  "tests/**/*.ts",
  "**/*.test.{ts,tsx}",
  "apps/ui-layer/src/shared/ui/test-setup.ts",
];
const sourceFiles = [
  ...browserFiles,
  ...nodeFiles,
  ...testFiles,
  "packages/ewans/**/*.ts",
];

// QRKO uses Prettier for layout. Keep one formatter and enforce it separately;
// neostandard, the TS compiler and React Hooks checks own code correctness.
const standard = neostandard({ ts: true, noStyle: true }).map((config) => ({
  ...config,
  files: sourceFiles,
  languageOptions: { ...config.languageOptions, globals: globals.es2022 },
}));

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/vendor/**",
      "**/coverage/**",
    ],
  },
  ...standard,
  {
    files: sourceFiles,
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      noInlineConfig: true,
    },
    rules: {
      "no-void": ["error", { allowAsStatement: true }],
      "no-nested-ternary": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-check": false,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    files: browserFiles,
    ignores: nodeFiles,
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  { files: nodeFiles, languageOptions: { globals: globals.node } },
  {
    files: testFiles,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
  },
  {
    files: ["apps/ui-layer/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": { meta: reactHooks.meta, rules: reactHooks.rules },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
] satisfies Linter.Config[];
