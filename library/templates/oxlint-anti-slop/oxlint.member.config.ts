import { defineConfig } from "oxlint";

import baseConfig from "{{root}}/oxlint.config.ts";

// A workspace member's oxlint config. It cannot use `extends: [baseConfig]`:
// oxlint rejects a relative `jsPlugins` specifier in a config reached through
// `extends` ("Relative JS plugin specifiers are not supported in configs
// provided via `extends`"), and the root base carries one. Spreading the
// base's `rules` and `overrides` inherits the same settings without dragging
// the base's `jsPlugins` in; the member declares its own, with a specifier
// relative to this file. `plugins` is not spread: the base does not declare it,
// so both configs fall back to oxlint's default plugin set. The import order
// is the one Biome's organizeImports leaves on the rendered file.
export default defineConfig({
  jsPlugins: [{ name: "anti-slop", specifier: "{{root}}/tools/oxlint/anti-slop/index.ts" }],
  overrides: baseConfig.overrides,
  rules: baseConfig.rules,
});
