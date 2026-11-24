---
id: design-system-contracts
title: Use the design system's variants and sizes
when: { requires: [{ file: components.json }] }
source: research/design-systems.md
enforcedBy: []
---

Use a component's variants and sizes, and add a variant only when the design calls for it.

Change the component at the source rather than restyling at the call site.

A design-system component owns its appearance. Its variants and sizes are the contract it publishes,
so a call site selects from them rather than describing the look again: `variant="destructive"` says
what the control means, while a pile of colour and border classes says how one instance happens to
look and drifts the moment the system changes. The same rule covers size, spacing and state — if the
component offers it, use the name.

The component code is owned, not a third-party package. A copied component — shadcn/ui's model — is
source the project can edit, so a missing treatment is fixed in that source and reviewed like any
other code. When the upstream component changes, review the upstream diff before overwriting the
copy: the copy may carry the project's own variants, and a blind overwrite drops them. Preserve the
contracts the component publishes to its callers — `asChild` composition, the `data-slot` hooks that
styling and tests select on, and the `cn()` merge that lets a caller's allowed classes win — and keep
the accessibility primitives the component wraps, because a restyle that drops a focus ring or a
label is a regression no gate reports.

Add a variant only when the design calls for a treatment the system does not have. A one-off that
appears once is a usage-site style, not a new variant; a treatment that recurs is a gap in the
component, and it is filled in the component so every caller gets it. Adding it at the call site
instead leaves the next caller to invent the same thing differently.

Put one-off styles at the usage site only where the design system allows it — layout, positioning,
the spacing a particular page needs — and never where the component owns the property. Restyling a
component that owns its appearance is the failure this practice names: the call site now carries a
second, invisible definition of the component, and the next change to the system does not reach it.

The shared library carries this practice, not a gate: the machine-checkable half is a project-local
recipe, because the linter that flags restyled components is not one the library installs.
