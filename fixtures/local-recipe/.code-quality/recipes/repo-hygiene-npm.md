---
id: repo-hygiene-npm
title: Local repo hygiene (shadow)
purpose: A local override of the library's repo-hygiene-npm, proving a local recipe wins on id collision.
when:
  language: [typescript]
cost: fast
priority: 60
files:
  - path: .local-shadow
    action: create
    scope: root
    template: templates/repo-hygiene-npm/local-shadow
verify:
  - run: test -f .local-shadow
    scope: root
---

## Apply

1. **`.local-shadow`** — create from `templates/repo-hygiene-npm/local-shadow`. This recipe shadows the library's `repo-hygiene-npm` by id, so the library's `.node-version` / `.gitignore` / `package.json` writes are never planned.

## Idempotency

- `.local-shadow` is a `create`: byte-identical on re-run, so it is a no-op.

## Undo

- Delete `.local-shadow`.
