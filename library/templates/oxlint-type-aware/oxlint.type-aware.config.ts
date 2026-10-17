import { defineConfig } from "oxlint";

import baseConfig from "./oxlint.config.ts";

// The type-aware pass. It spreads the base config — the anti-slop rules, the
// size and complexity caps, and the test-file overrides — and adds the rules
// that need the whole project's types rather than one file's syntax. The
// `jsPlugins` specifier is inherited from the base and resolves relative to
// this file, which sits beside it at the workspace root.
//
// `options.typeAware` makes oxlint run these rules through tsgolint, which
// analyses the project with the TypeScript compiler before linting. The
// `oxlint-tsgolint` package must be installed or oxlint refuses to start, and
// the rules are silently skipped when the option is absent — so the option and
// the dependency move together.
export default defineConfig({
  ...baseConfig,
  // The library's own gate scripts are plain `.mjs`, and a `.mjs` file cannot carry the type
  // annotations the type-aware rules need — `JSON.parse` returns `any`, and there is no
  // annotation to narrow it with. They are the library's code, not the project's, so the pass
  // does not report on them. A project that adds its own `.mjs` script either writes it in
  // TypeScript or adds it here.
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    "scripts/coverage-gate.mjs",
    "scripts/coverage-ignore-audit.mjs",
    "scripts/lint-gate.mjs",
    "scripts/lint-type-aware-gate.mjs",
    "scripts/typecheck-gate.mjs",
    "stryker.conf.mjs",
    "stryker.member.conf.mjs",
  ],
  options: { typeAware: true },
  rules: {
    ...baseConfig.rules,
    "typescript/await-thenable": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/restrict-plus-operands": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
  },
});
