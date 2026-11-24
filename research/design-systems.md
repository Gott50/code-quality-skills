---
topic: design-systems
question: >-
  How does a project keep a component's appearance in the design system rather
  than at its call sites, and which half of that can a gate fail on?
verdict: >-
  A design-system component publishes variants and sizes as its contract, so a
  call site selects from them and adds a variant only when the design needs a
  treatment the system lacks; restyling a component that owns its appearance is
  the violation. `@shadcn/lint`'s `no-restyle` rule can fail on classes passed to
  design-system components, but choosing a variant, adding one, and deciding
  which one-off styles a page may apply are judgement. The shared library
  therefore carries the practice, and the gate is a project-local recipe: the
  linter is not a library recipe, and `components.json` is the marker that
  selects the practice. Registry validation has the same shape — a local recipe
  selected on `registry.json`, with no shared recipe until a fixture proves one.
sources:
  - https://ui.shadcn.com/docs/components-json
  - https://ui.shadcn.com/schema.json
  - https://github.com/shadcn-ui/lint
  - https://github.com/shadcn-ui/lint/blob/main/SETUP.md
  - https://github.com/shadcn-ui/lint/blob/main/docs/rules.md
  - https://github.com/shadcn-ui/lint/blob/main/docs/design-systems.md
  - https://github.com/shadcn-ui/lint/blob/main/docs/adoption.md
  - https://github.com/shadcn-ui/lint/blob/main/docs/rules/no-restyle.md
  - https://www.npmjs.com/package/@shadcn/lint
  - https://ui.shadcn.com/docs/registry
  - https://ui.shadcn.com/docs/registry/registry-json
  - https://ui.shadcn.com/docs/registry/registry-item-json
  - https://ui.shadcn.com/schema/registry.json
  - https://ui.shadcn.com/schema/registry-item.json
---

# Design systems

## The marker: `components.json`

`components.json` is optional; it is only required if you're using the CLI to add components
([ui.shadcn.com/docs/components-json](https://ui.shadcn.com/docs/components-json)). Its schema fixes
the fields a tool can rely on: `style`, `tailwind` (`config`, `css`, `baseColor`, `cssVariables`,
`prefix`; required `config`, `css`, `baseColor`, `cssVariables`), `rsc`, `tsx`, `iconLibrary`,
`aliases` (`utils`, `components`, `ui`, `lib`, `hooks`; required `utils`, `components`),
`menuColor`, `menuAccent`, `rtl` and `registries`
([ui.shadcn.com/schema.json](https://ui.shadcn.com/schema.json)).

That is why the practice's predicate is `{ file: components.json }` rather than a dependency: the
file is the project's declaration that it has a design system with a component directory and import
aliases, and it exists whether or not the CLI is used afterwards. The fixture `fixtures/shadcn-ts`
carries one with `style: new-york`, `tailwind.css: app/globals.css`, `baseColor: neutral`,
`cssVariables: true`, the five aliases and `iconLibrary: lucide`; `fixtures/plain-ts` has none, so
the practice is selected on the first and not the second.

## Variants and sizes are the contract

"Use variants for appearances you want to reuse. Use contracts to define which styling changes a
page can make." "If an existing variant fits, use it. When the design needs a new treatment, add it
to the component."
([docs/design-systems.md](https://github.com/shadcn-ui/lint/blob/main/docs/design-systems.md)). The
doc's worked example adds the treatment to the Button's existing `cva` `variant` definition and then
uses it by name (same source).

So the call site's job is selection, not description. A variant name is a statement about meaning —
`destructive`, `secondary` — that survives a restyle; a set of utility classes is a statement about
one instance's pixels that does not. The component's `cva` definition is the single place the
appearance is written, and every caller reads it.

## Restyling at the call site

`@shadcn/lint` is "an agent-first linter for Tailwind design systems" that works with Tailwind v4
projects, with or without shadcn/ui, through ESLint and Oxlint, for React, Svelte and Vue
([github.com/shadcn-ui/lint](https://github.com/shadcn-ui/lint)). Its rules are `no-restyle`
(classes passed to design-system components), `no-raw-colors`, `no-arbitrary-values`,
`no-inline-styles`, `no-unknown-classes` and `require-static-classes`
([docs/rules.md](https://github.com/shadcn-ui/lint/blob/main/docs/rules.md)).

`no-restyle` is the rule that names this practice's failure: "Use component variants for appearance
and `className` for the changes your policy allows. The error lists the component's variants or
sizes and the file that defines them."
([docs/rules/no-restyle.md](https://github.com/shadcn-ui/lint/blob/main/docs/rules/no-restyle.md)).
Its configuration is `"shadcn/no-restyle": ["error", { allow: ["layout"] }]`, and it is turned off
inside the component directory "so components can style their own internals" (same source;
[SETUP.md](https://github.com/shadcn-ui/lint/blob/main/SETUP.md)).

The `allow` list is the design system's answer to "where may a one-off style live": layout is the
usual allowance, because a page owns where a component sits and the component owns how it looks.
That list is a policy decision, not a default the tool can infer.

## Adding a variant

A treatment that recurs belongs in the component. The design-systems doc says to add it to the
existing `cva` `variant` definition and use it by name
([docs/design-systems.md](https://github.com/shadcn-ui/lint/blob/main/docs/design-systems.md)); the
alternative — the same class string copied into three call sites — is three definitions that will
diverge. A treatment that appears once is not a variant; it is the one-off the `allow` policy
covers, or it is a sign the design is not settled.

## Adoption

`@shadcn/lint` is adopted one rule at a time: "Start with one rule. Fix the common violations, then
add more checks." Set `no-restyle` to `warn` in the main `rules` object, then "Use the measured count
in your lint script. For example, if the project has 287 warnings: `"lint": "eslint . --max-warnings
287"`. Run this script in CI. It fails when the total increases. Lower the cap as you fix findings."
([docs/adoption.md](https://github.com/shadcn-ui/lint/blob/main/docs/adoption.md)).

That is the same ratchet shape the library uses for lint debt: a recorded count that may not rise,
lowered as findings are fixed. It is also why the gate is a local recipe rather than a library
recipe — the count is the project's, and the rule set is the project's choice.

`SETUP.md` states the boundary: "Install and register `@shadcn/lint` in the user's project. Do not
enable new rules or change existing rule policies." It finds "the component directories, import
aliases, and Tailwind v4 themes. Use `components.json` where available", preserves existing rules,
parsers, scripts and ignores, and leaves "choosing rules and defining what is allowed to the user"
([SETUP.md](https://github.com/shadcn-ui/lint/blob/main/SETUP.md)). The package is `@shadcn/lint`
v0.2.5, MIT, exporting `.` and `./package.json`
([npmjs.com/package/@shadcn/lint](https://www.npmjs.com/package/@shadcn/lint)).

## The registry

A project that publishes its components as a registry describes them with `registry.json` and
`registry-item.json` ([ui.shadcn.com/docs/registry](https://ui.shadcn.com/docs/registry)).
`registry.json` carries `$schema`, `name`, `homepage`, `include` (relative paths to other registry
files), `items` and `pagination`, and requires `items` or `include`
([ui.shadcn.com/schema/registry.json](https://ui.shadcn.com/schema/registry.json);
[registry-json docs](https://ui.shadcn.com/docs/registry/registry-json)). An item carries `name`,
`type` (one of `registry:lib`, `registry:block`, `registry:component`, `registry:ui`,
`registry:hook`, `registry:theme`, `registry:page`, `registry:file`, `registry:style`,
`registry:base`, `registry:font`, `registry:item`), `description`, `title`, `author`,
`dependencies`, `devDependencies`, `registryDependencies` and `files`
([ui.shadcn.com/schema/registry-item.json](https://ui.shadcn.com/schema/registry-item.json);
[registry-item-json docs](https://ui.shadcn.com/docs/registry/registry-item-json)). The registry
"works with any project type and any framework, not limited to React"
([ui.shadcn.com/docs/registry](https://ui.shadcn.com/docs/registry)).

### Registry validation as a local recipe

The schemas are published, so validating a registry is mechanical: `registry.json` against
[registry.json](https://ui.shadcn.com/schema/registry.json) and every `registry-item.json` against
[registry-item.json](https://ui.shadcn.com/schema/registry-item.json). The check is authored with
`code-quality-author` into the project's local library rather than shipped: it selects on
`{ file: registry.json }`, validates the root file and each item file against its schema, and fails
on a missing file, a `type` outside the enum, or a `registryDependencies` entry that names no item
in the registry and is not a URL. The judgement half — whether an item's `type` is the right one,
whether a dependency belongs in `registryDependencies` or `dependencies`, whether the registry
should exist at all — is the existing audit/verify discipline, not a new practice.

`gaps.mjs` does not rank this gap. It ranks three kinds — an uncovered tooling category, a recipe one
predicate away, and a gate no selected practice explains — and a registry is none of them: the
project may carry no registry tooling the detector tracks, and the missing check is not a tooling
category. The local recipe is requested explicitly, by a user who knows the project publishes a
registry.

Three things the library deliberately does not ship:

- A shared `shadcn` CLI recipe. The CLI is an application dependency, not gate tooling; installing
  it is the project's decision, and the library does not install application dependencies.
- A shared registry recipe before a `registry-ts` fixture exists. A recipe is proven by a fixture;
  without one, the recipe would be prose the library cannot verify.
- A `registry:health` gate. Health is a runtime monitor — whether the registry serves, whether an
  item installs — not a static check a recipe can run.

## Enforceable vs. judgement

**A gate can fail on it:**

- Classes passed to a design-system component that the policy does not allow (`no-restyle`).
- Raw colours, arbitrary values, inline styles, unknown classes, dynamic class strings
  (`no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `no-unknown-classes`,
  `require-static-classes`).
- The warning count rising above the recorded cap
  ([docs/adoption.md](https://github.com/shadcn-ui/lint/blob/main/docs/adoption.md)).
- A registry file that does not match its schema (local recipe).

**Judgement, not gateable:**

- Which variant a call site should use.
- Whether a treatment is a new variant or a one-off.
- Which properties the `allow` list covers.
- Which rules to enable and at what severity
  ([SETUP.md](https://github.com/shadcn-ui/lint/blob/main/SETUP.md)).
- Whether a component's appearance should change at all.
- Whether an item's `type` is the right one, and whether a dependency belongs in
  `registryDependencies` or `dependencies`.
- Whether the project should publish a registry at all.

## Routing

| Practice | Gate? | Where |
| --- | --- | --- |
| `design-system-contracts` | No — local recipe | `library/practices/design-system-contracts.md`; the gate is a project-local recipe authored with `code-quality-author`, not a library recipe |
| `@shadcn/lint` (`no-restyle` and the Tailwind rules) | No — local recipe | `.code-quality/recipes/design-system-lint.md` in the project, authored with `code-quality-author` |
| Registry validation | No — local recipe | `.code-quality/recipes/registry-validate.md` in the project, authored with `code-quality-author`; selects on `{ file: registry.json }` |
