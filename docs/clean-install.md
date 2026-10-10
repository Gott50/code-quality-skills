# Clean-install proof

The `skills` CLI install contract, exercised end to end from a fresh directory: install, list,
update, remove. Two runs, both with `skills` v1.7.1 on Node v26.8.1:

- **2026-10-10**, against the local repo with both skills present — the two-skill run: the CLI
  reports **Found 2 skills**, so `-s <name>` is load-bearing.
- **2026-10-09**, against `Gott50/code-quality-skills` at `ec4845b` (one skill) — the GitHub-source
  run, which proves the clone path and the update step.

## Two skills: `-s <name>` selects one

The repo exposes two skills, so the CLI offers both and `-s <name>` picks one. Without `-s` it
installs both.

```sh
$ mkdir /tmp/cqs-proof && cd /tmp/cqs-proof

$ npx skills@latest add <repo> -l

│
●   claude  Agent detected — installing non-interactively
│
◇  Source: <repo>
│
◇  Local path validated
│
◇  Found 2 skills

│
◇  Available Skills
│
│    code-quality-improve
│
│      Raises a TypeScript repo's code-quality score one target at a time. Use when a repo already has code-quality gates and a committed baseline and the user wants to improve coverage, mutation, lint, typecheck, dead code or complexity without regressing.
│
│    code-quality-setup
│
│      Sets up or repairs code-quality gates in a TypeScript repo. Use when a TypeScript project needs formatting, linting, typechecking, tests, coverage, mutation testing, git hooks, or CI gates wired in, audited, or repaired.

│
└  Use --skill <name> to install specific skills


$ npx skills@latest add <repo> -s code-quality-improve -y

│
●   claude  Agent detected — installing non-interactively
│
◇  Source: <repo>
│
◇  Local path validated
│
◇  Found 2 skills
│
●  Selected 1 skill: code-quality-improve

│
◇  Installation Summary ──────────────────────────────────────────────────╮
│                                                                         │
│  ./.agents/skills/code-quality-improve                                  │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlink → Claude Code                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
◇  Installation complete

│
◇  Installed 1 skill ─────────────────────────────────────────────────────╮
│                                                                         │
│  ✓ ./.agents/skills/code-quality-improve                                │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlinked: Claude Code                                               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯

│
└  Done!  Review skills before use; they run with full agent permissions.


$ npx skills@latest list
Project Skills

code-quality-improve ./.agents/skills/code-quality-improve
  Agents: GitHub Copilot, Claude Code  Source: <repo>


$ find .agents/skills -type f
.agents/skills/code-quality-improve/SKILL.md
.agents/skills/code-quality-improve/agents/openai.yaml
.agents/skills/code-quality-improve/references/raise.md
.agents/skills/code-quality-improve/scripts/RANK-SCHEMA.md
.agents/skills/code-quality-improve/scripts/rank.mjs


$ cat skills-lock.json
{
  "version": 1,
  "skills": {
    "code-quality-improve": {
      "source": "<repo>",
      "sourceType": "local",
      "computedHash": "1a0ca8c1f1742e650070ee41c07e994cebccf9fe627e638df0198a02a0715a56"
    }
  }
}


$ npx skills@latest remove code-quality-improve -y
│
◇  Removal process complete
│
◆  Successfully removed 1 skill(s)

│
└  Done!


$ cat skills-lock.json
{
  "version": 1,
  "skills": {}
}
```

The install copies the whole `skills/code-quality-improve/` tree — `SKILL.md`, `agents/openai.yaml`,
`references/raise.md`, `scripts/RANK-SCHEMA.md`, `scripts/rank.mjs` — into
`.agents/skills/code-quality-improve/` and records it in `skills-lock.json`; `remove` clears the
entry. The lockfile's `computedHash` covers every file in the skill directory, which is what makes
`update` see a change to a script or a reference.

`<repo>` is the path the source was given — the local checkout — and the lockfile records it
verbatim (a relative path for a local source).

The run above used the local repo because the second skill was not yet pushed at run time; the
GitHub-source path is proven by the run below. `update` is a no-op for a local source ("No project
skills to update"), so the update step is proven on the GitHub source.

## The GitHub-source run (one skill)

Run 2026-10-09 against `Gott50/code-quality-skills` at `ec4845b`, with `skills` v1.7.1 on Node
v26.8.1. This run predates the second skill, so the CLI reported **Found 1 skill**; the repo now
exposes two, and the CLI reports **Found 2 skills** (see above).

```sh
$ mkdir /tmp/cqs-proof && cd /tmp/cqs-proof

$ npx skills@latest add Gott50/code-quality-skills -s code-quality-setup -y

│
●   claude  Agent detected — installing non-interactively
│
◇  Source: https://github.com/Gott50/code-quality-skills.git
│
◒  Cloning repository…...
◇  Repository cloned
│

◇  Found 1 skill
│
●  Selected 1 skill: code-quality-setup

│
◇  Installation Summary ──────────────────────────────────────────────────╮
│                                                                         │
│  ./.agents/skills/code-quality-setup                                    │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlink → Claude Code                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
◇  Security Risk Assessments ────────────────────────────────────────╮
│                                                                    │
│                      Gen               Socket            Snyk      │
│  code-quality-setup  Safe              0 alerts          Low Risk  │
│                                                                    │
│  Details: https://skills.sh/Gott50/code-quality-skills             │
│                                                                    │
├────────────────────────────────────────────────────────────────────╯
│

◒  Installing skills…...
◇  Installation complete

│
◇  Installed 1 skill ─────────────────────────────────────────────────────╮
│                                                                         │
│  ✓ ./.agents/skills/code-quality-setup                                  │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlinked: Claude Code                                               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯

│
└  Done!  Review skills before use; they run with full agent permissions.


$ npx skills@latest list
Project Skills

code-quality-setup ./.agents/skills/code-quality-setup
  Agents: GitHub Copilot, Claude Code  Source: Gott50/code-quality-skills


$ npx skills@latest update -y
Checking for skill updates…

Updating for: Universal, Claude Code
Checking 1 skill(s)…

✓ All project skills are up to date



$ npx skills@latest remove code-quality-setup -y
│
●   claude  Agent detected — removing non-interactively
│
◇  Found 1 unique installed skill(s)
│
◇  Removal process complete
│
◆  Successfully removed 1 skill(s)

│
└  Done!


$ cat skills-lock.json
{
  "version": 1,
  "skills": {}
}
```

The install copies the whole `skills/code-quality-setup/` tree into `.agents/skills/code-quality-setup/`
and records it in `skills-lock.json`; `remove` clears the entry. The lockfile's `computedHash` covers
every file in the skill directory, which is what makes `update` see a recipe or template change.
