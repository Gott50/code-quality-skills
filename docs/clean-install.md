# Clean-install proof

The `skills` CLI install contract, exercised end to end from a fresh directory: install, list,
update, remove. Run 2026-10-09 against `Gott50/code-quality-skills` at `ec4845b`, with
`skills` v1.7.1 on Node v26.8.1.

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
