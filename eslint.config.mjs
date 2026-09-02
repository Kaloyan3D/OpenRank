// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.expo/**",
      "**/dist/**",
      "**/coverage/**",
      "**/android/**",
      "**/ios/**",
      // Local harness tooling - not part of the repository.
      ".tools/**",
      ".ai-harness/**",
      // Untouched upstream copy - must remain byte-identical to the pinned
      // Hevy Ranks commit; it is exercised through tests, not linted.
      "packages/ranking-core/src/legacy/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // Plain Node.js scripts and configs (ESM/CJS).
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["apps/mobile/**/*.tsx", "apps/mobile/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
