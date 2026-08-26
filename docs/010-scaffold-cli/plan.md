# Task 010 — The scaffolding CLI

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Make ql-pipeline installable as a package, with `init` / `upgrade` / `doctor` commands that adopt it in a repo and keep the files it manages current — without ever eating local customisation. |

## What is actually being distributed

The engine does **not** need distributing. Consumers reference the reusable workflow by ref (`uses: …/pr-pipeline.yml@main`), so improvements to routing, review, and fixing already reach every repo on their next PR with no action.

What does not auto-update is the **consumer-side scaffolding** — caller workflow, `pipeline.config.yml`, `.cursor/rules/`. That was copy-paste, and copy-paste goes stale silently. The package carries that, plus the CLI to apply and refresh it.

Getting this distinction right shaped the whole task: the package is a *scaffolding* tool, not a runtime dependency of the pipeline.

## Distribution: git, not a registry

`pnpm add -D github:0xb1te/ql-pipeline` installs straight from the private repo. No registry, no publishing pipeline, no `.npmrc` auth to distribute. `prepare` builds on install, so `dist/` need not be committed.

A registry (GitHub Packages) buys semver ranges and CI installs without SSH keys. Neither is needed to start, and adding it later changes nothing about the CLI. Recommending the simpler thing first was deliberate.

## The hard part: `upgrade` must not eat customisation

This is the whole risk of the feature. An upgrade that silently overwrites someone's build commands is worse than no upgrade command at all.

**Two file modes:**

- **managed** — ql-pipeline's to maintain (caller workflow, Cursor rules). Regenerated so improvements propagate.
- **owned** — the consumer's (`pipeline.config.yml`). Scaffolded once, then never touched. Not even by `--force`: it holds their gate commands and target branch, and losing it is not a recoverable inconvenience.

**Drift detection via a manifest.** `.ql-pipeline/manifest.json` records a content hash of every managed file at the moment it is written. On upgrade:

| Current state | Conclusion | Action |
|---|---|---|
| Hash matches the manifest | We provably wrote it, untouched | Update |
| Hash differs | The user edited it | **Skip**, report, suggest `--force` |
| No manifest entry | We cannot prove authorship | **Skip** — assume theirs |
| File absent | New in this version, or deleted | Create |

The "no manifest entry" rule matters for repos scaffolded by hand or before manifests existed: absence of proof is treated as proof of absence *in the safe direction*.

**Why a manifest rather than stamping files.** A version stamp inside each file would have to sit after `.mdc` frontmatter (which must be first for Cursor to parse it), making "strip the stamp, hash the rest" fiddly and format-specific. An external manifest has no format concerns and works for any file type.

**Line endings are normalised before hashing.** A Windows checkout rewriting LF to CRLF is not an edit, and treating it as one would make `upgrade` refuse to do anything on half the team's machines.

## `doctor` says what it cannot know

It checks the caller workflow, config validity, gate coverage, standards resolution, gitignore hygiene, and Cursor rules. It **cannot** check whether `CURSOR_API_KEY` and `STANDARDS_TOKEN` are set — those are Actions secrets, and a local CLI has no business reading them. It prints that limitation rather than implying a clean bill of health it cannot give.

One bug found by running it: with an unparseable config it reported standards as *"disabled"* — stating as fact a setting it had never successfully read. Now reports "not checked", like the gates check already did.

## Verification

`npm run typecheck && npm run lint && npm run build && npm test` green — **394 tests across 34 files**.

Beyond unit tests, the whole flow was exercised against real throwaway repositories, and against a **real packed tarball installed as a dependency** (`npm pack` → `npm install` in a fresh project), which is what proves `bin`, `files`, and template resolution actually work end to end:

- `init` on an empty repo → 9 files created, `.gitignore` appended, next steps printed.
- A user then edited a managed rule *and* changed a gate command to `nx build web-frontend`; a template was changed upstream to simulate a new version.
- `upgrade` → updated the untouched file, **left the edited rule alone** with instructions, **never touched the config**. Verified by reading the files back: `nx build web-frontend` survived, their rule comment survived, the upstream change landed.
- `upgrade --force` → discarded the rule edit as documented, and **still** left `pipeline.config.yml` untouched.
- `doctor` → passed on a good setup; on a broken config reported `FAIL` with the real parse error and exit code 1; warned correctly on missing gates, missing rules, and an un-cloned standards checkout.

Verification boundary unchanged from [SPECIFICATION.md §8](../SPECIFICATION.md): no live Actions run, no live `cursor-agent` cycle. Additionally untested: installing over the network from the private repo (`pnpm add github:…`), which needs credentials this environment does not have — the tarball install exercises the same packaging machinery, but not git auth or the `prepare` build.
