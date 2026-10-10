# code-quality-skills

A skill source. The repo's product is two installable agent skills:

- `skills/code-quality-setup/` — wires code-quality gates into a TypeScript repo from a library of recipes.
- `skills/code-quality-improve/` — raises the score one target at a time, reading the committed baseline and the artifacts the gates produce.

They are installed with `npx skills@latest add Gott50/code-quality-skills -s <name>`; the repo exposes two skills, so `-s <name>` is load-bearing. The skills CLI copies the whole `skills/<name>/` directory into the consumer's `.agents/skills/<name>/`, so anything inside a skill ships to every user and churns the lockfile hash. Fixtures and other non-shipping assets live at the repo root.

The repo also vendors Matt Pocock's `mattpocock/skills` under `.agents/skills/`, pinned in `skills-lock.json`. Those are inputs, not the product.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `Gott50/code-quality-skills`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to label strings of the same name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
