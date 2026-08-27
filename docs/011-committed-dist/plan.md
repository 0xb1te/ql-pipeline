# Task 011 — Ship `dist/` committed: fixing a real install break

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Fix two real `pnpm add -D github:0xb1te/ql-pipeline` failures hit adopting the CLI in a live consumer repo, without weakening the guarantee that installed `dist/` matches `src/`. |

## The bugs, as reported

Adopting the CLI from [010](../010-scaffold-cli/plan.md) in a real pnpm-workspace consumer repo (`courses-app`) failed twice in a row:

```
pnpm add -D github:0xb1te/ql-pipeline
ERR_PNPM_ADDING_TO_ROOT  Running this command will add the dependency to the
workspace root, which might not be what you want …

pnpm add -D github:0xb1te/ql-pipeline -w
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  … needs to execute build scripts but is
not in the "onlyBuiltDependencies" allowlist.
```

Both are pnpm 10+ behaviours, not ql-pipeline bugs in the traditional sense — but Task 010 designed around neither of them, so the CLI it shipped was, in practice, uninstallable from a pnpm workspace.

## Root cause 1 — `ERR_PNPM_ADDING_TO_ROOT`

Not a bug: `.github/workflows/` and `.cursor/rules/` must live at the true repository root for GitHub Actions and Cursor to find them, so installing at the workspace root is the *correct* behaviour for this tool, not a workaround to route around. pnpm just refuses to guess that for you.

**Fix: document it**, not code it away. `-w` (or `--workspace-root`) is the right flag, every time, for every workspace consumer. Added a "In a pnpm workspace" section to both install docs rather than silencing the check.

## Root cause 2 — `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

This one was a real bug. Task 010 shipped `"prepare": "npm run build"` with `dist/` gitignored, on the assumption that installing from git would just build on install like `npm`/`yarn` do. pnpm 10+ blocks lifecycle scripts for git-hosted dependencies by default (supply-chain hardening) unless the package is named in the consumer's `onlyBuiltDependencies` — so the package could never produce the `dist/` it needed to run. A hard install blocker for every consumer, every time, with no workaround short of editing their `pnpm-workspace.yaml`.

**Reproduced before fixing.** A scratchpad repo with a `pnpm-workspace.yaml`, installing `github:0xb1te/ql-pipeline#30bd961` (the pre-fix commit) via `git+file://` to exercise pnpm's real git-dependency code path without needing the actual GitHub host, reproduced the exact error.

**Fix: commit `dist/`, drop `prepare` entirely.** Removed `dist/` from `.gitignore`, deleted the `prepare` script, kept `build` for contributors/CI. No install-time script execution is needed at all, so there's nothing left for pnpm to block. This is the standard pattern for git-distributed CLI packages (the alternative — telling every consumer to add `ql-pipeline` to `onlyBuiltDependencies` in their `pnpm-workspace.yaml` — trades a one-time repo change for a permanent per-consumer one, for no benefit here since ql-pipeline's build has no reason to run on the consumer's machine).

**The new risk: `dist/` drifting from `src/`.** Committing build output only works if it's never stale. Added a CI step to `self-check.yml`, after `build` and before `test`, that fails the build if `git diff` shows *any* change to `dist/` post-build — i.e. a PR that edited `src/` without regenerating `dist/` fails self-check. This is the same drift-guard shape as any other generated-and-committed-artifact pattern.

## Verification

**The CI drift-guard, tested against itself** (not just read as correct): modified `src/shared/logger.ts`, ran `npm run build`, confirmed `git diff --quiet -- dist/` now reports drift (exit 1, as the workflow step would). Reverted, rebuilt, confirmed clean (exit 0). Testing this once against an *unmodified* tree first would have been a false-positive verification — caught and redone before trusting it.

**The actual install, fixed, against a real pnpm git-dependency path:**

```bash
pnpm add -D "git+file:///F:/Projects/ql-pipeline" -w
# Packages: +28
# Done in 3.4s — no ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED
pnpm exec ql-pipeline init      # 9 files created, as in 010
pnpm exec ql-pipeline doctor    # checks pass/warn as expected
```

Full suite green: `npm run typecheck && npm run lint && npm run build && npm test` — 394 tests across 34 files, unchanged from [010](../010-scaffold-cli/plan.md) (this is a packaging fix, not new runtime logic).
