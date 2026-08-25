# Task 007 — Specification conformance

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Make the whole project — code, workflow, docs, AI instruction files — actually conform to the pivoted paradigm from Task 001's decisions, and close the gaps that would have stopped the pipeline working for real. |

## Why this task exists

Phases 1–5 delivered the architecture, but an audit against the specification found three classes of problem: **documented features that were never implemented**, **real functional bugs that would have broken a live run**, and **docs describing the pre-pivot design**. This task closes all three and adds [`docs/SPECIFICATION.md`](../SPECIFICATION.md) as the canonical contract, with a conformance table pointing at the code and tests for each requirement.

## A. Documented but unimplemented (docs promised, code didn't deliver)

| Gap | Fix |
|---|---|
| **Consumer rule overrides.** `docs/integration-guide.md` §5 told consumers to add `.github/pipeline-rules/<area>.rules`; nothing in `src/` ever looked there — the string appeared only as a protected path. Every consumer would have silently been reviewed against ql-pipeline's own defaults. | New [`src/rules/rule-resolver.ts`](../../src/rules/rule-resolver.ts): per-area consumer override with shipped fallback, `_common.rules` deliberately non-overridable. Prompt blocks are labelled with each file's origin so the review context is self-describing. |
| **`merge.required_checks`.** Parsed, stored on the config type, and never read by anything. Pure dead config. | New [`src/verdict/required-checks.ts`](../../src/verdict/required-checks.ts) gives it real semantics: a stage outside the list still runs but yields advisory findings, and `ai-review` is skipped outright when not required (a review whose findings can't block is pure cost). |
| **`merge.target_branch`.** Also parsed and never used — the pipeline merged whatever PR it was handed, regardless of the branch config designated. This is core requirement R3. | New [`src/merger/target-branch.ts`](../../src/merger/target-branch.ts): resolves the target (including the per-area overrides promised in 001/plan.md §4.7), refuses to guess when areas disagree, and only governs PRs actually aimed at the resolved target. |

## B. Functional bugs that would have broken a live run

These are the ones that mattered most; each would have shown up on the very first real PR.

1. **The reviewer's read-only guard would have failed every single PR.** `actions/checkout` can only write inside the workspace, so ql-pipeline is checked out to `.ql-pipeline/` *inside the repo under review*, and `npm ci` then fills it with `node_modules`. The guard asked "is `git status --porcelain` empty?" — which it never would be. Fixed twice over: the workflow adds `/.ql-pipeline/` to `.git/info/exclude` (local-only, never touches the repo's tracked `.gitignore`), and the guard now compares a **snapshot taken before the review against one taken after** rather than demanding a pristine tree.

2. **The fix agent could not have pushed anything.** `actions/checkout` on `pull_request` defaults to a detached HEAD at a synthetic merge commit — there is no branch to commit onto or push back to. The workflow now checks out the PR's actual head branch.

3. **`git commit` would have failed outright** — no `user.name`/`user.email` is configured on a fresh runner. The workflow now sets a bot identity.

4. **`cursor-agent` was never installed.** The workflow invoked a binary that didn't exist on the runner. Now installed and verified on PATH before the pipeline runs.

5. **The fix commit would have swept up build artifacts.** `git add -A` after gates have run stages `dist/`, caches, and anything else the build produced. The fixer now stages *exactly* the paths the agent touched, computed as the difference between the before/after snapshots.

6. **Fork PRs would have "attempted" impossible fixes.** A fork's branch can't be pushed to with the base repo's token. Forks are now detected from the payload and escalated instead.

7. **Nothing prevented merging an unreviewed revision.** A commit landing mid-run would have been merged on the strength of a review of the *previous* code. The head SHA is now re-checked before merging and pinned on the merge call, so GitHub itself rejects a racing merge.

## C. Design decisions recorded

- **Snapshot-diffing beats pristine-tree checks.** Both the reviewer's read-only guard and the fixer's "did anything change?" test compare against a baseline. By the time either runs, the gates have already dirtied the tree; a baseline is the only formulation that is both correct and usable, and it makes the fixer's staging precise for free.
- **An unreadable snapshot counts as "modified".** If read-only behaviour can't be verified, it isn't assumed. Same principle as the existing fail-closed handling of malformed AI output.
- **The governance pre-check runs before any API call.** Resolving the exact target branch needs the PR's areas, which needs its commits — but if the base branch isn't the default target *or* any per-area override, no area combination could ever select it. That cheap test drops unrelated PRs at zero cost.
- **Rule overrides replace rather than merge.** A partial merge would leave it ambiguous which definition of a rule ID won, and the reviewer cites rule IDs as evidence.

## Verification

`npm run typecheck && npm run lint && npm run build && npm test` all green, 263 tests across 24 files. `commit-parser` and the verdict engine hold their 100%-branch-coverage bar (RULES.md R3.2).

Beyond unit and integration tests, `main.ts` was smoke-tested against **real webhook event payloads** rather than only fakes, exercising both sides of the governance guard: a PR based on `develop` against a `main`-configured pipeline exits cleanly at zero cost, and the same PR re-based on `main` proceeds into the API. The guard chain (`GITHUB_TOKEN` → config load → PR context → governance) was confirmed to fail closed at each step.

The verification boundary from §8 of the specification is unchanged: no live Actions run, no live `cursor-agent` cycle.
