import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    // oxlint lints node_modules unless a .gitignore excludes it, and a repo
    // that has not run the biome-assist recipe has no .gitignore entry yet.
    "node_modules/**",
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  overrides: [
    {
      files: ["**/*.test.ts"],
      rules: {
        // Test files are assertion-heavy; the line/statement caps are not
        // meaningful for them and force coverage-degrading condensation.
        "max-lines": "off",
        "max-statements": "off",
      },
    },
  ],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    complexity: ["error", 10], // cyclomatic complexity threshold
    "max-classes-per-file": ["error", 1],
    "max-depth": ["error", 4], // nesting depth
    "max-lines": ["error", 400], // file size
    "max-lines-per-function": ["error", 60],
    "max-nested-callbacks": ["error", 3], // callback pyramid
    "max-params": ["error", 4], // arg count
    "max-statements": ["error", 20], // statements per function
  },
});
