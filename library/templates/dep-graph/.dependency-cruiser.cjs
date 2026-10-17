/**
 * dependency-cruiser — the dep-graph gate's rules.
 *
 * Two rules, both walls: a cycle, and a relative import that reaches into
 * another workspace member's `src/`. A repo that already carries violations
 * records them in `.dependency-cruiser-known-violations.json` (see
 * `dep-graph:baseline` in package.json) instead of lowering a rule's severity.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      comment:
        "A cycle makes the two modules one unit: neither can be understood, tested or replaced alone.",
      from: {},
      name: "no-circular",
      severity: "error",
      to: { circular: true },
    },
    {
      comment:
        "Import a workspace member by its package name, never by a relative path into its src/.",
      // `$1` is the importing member's root (`packages/a`, `packages/nested/b`),
      // so the rule holds at any member depth. The lookahead keeps a member's
      // own relative imports legal; `dependencyTypes: ["local"]` keeps an
      // import by package name (which resolves into the same directory) legal.
      from: { path: "^packages/(.+)/src/" },
      name: "no-deep-import-into-another-package",
      severity: "error",
      to: { dependencyTypes: ["local"], path: "^packages/(?!$1/).*/src/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage|\\.stryker-tmp)/" },
    // dependency-cruiser transpiles TypeScript to JavaScript before parsing it
    // by default, and the transpiler elides an import whose binding is unused —
    // so a cycle or a deep import carried by an unused (or `import type`) edge
    // would be invisible. Reading the pre-compilation dependencies keeps every
    // edge the source states.
    tsPreCompilationDeps: true,
  },
};
