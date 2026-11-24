# shadcn-local-recipe

A fixture for the local-recipe path, not a consumer deliverable.

`components.json` makes the project a shadcn project. `.code-quality/recipes/design-system-lint.md`
and its template are the local layer: `check-local.mjs` validates the recipe contract and formats
the template, and `plan.mjs` selects the recipe on `when.requires: [{ file: components.json }]` and
renders `eslint.config.mjs` from `templates/design-system-lint/eslint.config.mjs`.

The fixture proves the path a project takes when it wants a gate the shared library does not ship:
the recipe lives in the project, the detector reads it beside the library's, and the plan writes it
like any other recipe. It is not a deliverable a consumer installs.
