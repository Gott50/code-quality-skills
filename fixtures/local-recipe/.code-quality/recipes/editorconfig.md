---
id: editorconfig
title: EditorConfig for consistent whitespace
purpose: Write a .editorconfig so every editor agrees on indentation, charset and line endings.
when:
  language: [typescript]
cost: fast
priority: 20
files:
  - path: .editorconfig
    action: create
    scope: root
    template: templates/editorconfig/editorconfig
verify:
  - run: test -f .editorconfig
    scope: root
---

## Apply

1. **`.editorconfig`** — create from `templates/editorconfig/editorconfig`. A project that already has one is a `create` drift, reported and applied only on approval.

## Idempotency

- `.editorconfig` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.

## Undo

- Delete `.editorconfig`.
