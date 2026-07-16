# Task 005 — Phase 4: Fix loop

| | |
|---|---|
| **Status** | 🟢 Approved (part of the phase 1–5 build-out approved in Task 001) |
| **Parent** | [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7 "Phase 4 — Fix loop" |

## Scope

- **`src/fixer/attempt-counter.ts`**: pure — counts prior fix attempts by counting `[bot]`-suffixed commits already on the PR (RULES.md R2.3), rather than inventing a separate state store (a PR label or comment counter). Attempt count is then just a property of the commit history the pipeline already fetches.
- **`src/fixer/complaint.ts`**: pure — formats a complaint (the blocking findings) as a request-changes review body and builds the fixer prompt from `prompts/fixer.md`.
- **`src/fixer/protected-paths.ts`**: impure — reverts any fixer edits to the configured protected paths via `git checkout --`, per-path so one nonexistent path doesn't abort the rest.
- **`src/fixer/fixer.ts`**: orchestration — invokes `cursor-agent` in default (write-capable) mode via the same `runCursorAgent` from Phase 3's `cursor-runner.ts`, reverts protected paths, then commits and pushes *from pipeline code*, never trusting the agent's own commit.
- **`GithubClient` extension**: `requestChangesWithComments` (the complaint review) alongside Phase 3's `approveWithComments`.
- **`main.ts`**: FIX now actually attempts a fix instead of failing the check; BLOCK posts the complaint too (so a human sees why, whether it's day-one-unfixable or attempts-exhausted).

## Design decisions worth recording

1. **Attempt counting from commit history, not new state.** `countFixAttempts` filters the PR's commit messages for ones ending `[bot]` (case-sensitive, matching RULES.md R2.3's convention exactly) and counts them. This is idempotent, requires no new GitHub API surface (labels/comments), and falls naturally out of data `main.ts` already fetches.
2. **Protected-path revert fixed a real default-config bug found while designing this.** The shipped `DEFAULT_PROTECTED_PATHS` (Phase 1) was `rules/`, `prompts/`, `pipeline.config.yml`, `.github/workflows/` — ql-pipeline's *own* folder names. A consumer repo has no `rules/`/`prompts/` folder; the fixer would never find anything to protect there because the paths named don't exist in *their* tree. Fixed: the shipped default is now `.github/workflows/`, `.github/pipeline.config.yml`, `.github/pipeline-rules/` (paths every consumer plausibly has, per the plan's own §4.8 override model); ql-pipeline's own `pipeline.config.yml` now explicitly overrides this back to its own structure, with a comment explaining why the two differ.
3. **`git checkout -- <path>` runs per-path, swallowing errors.** A single shell invocation covering every protected path would abort entirely if even one path doesn't exist in a given repo (git errors on an unknown pathspec) — since not every consumer will have all three default paths (e.g., no rule overrides), each path is reverted independently and a missing path is simply nothing to protect, not a failure.
4. **Commit and push are pipeline code, never the agent's.** The fixer's cursor-agent invocation only produces a working-tree diff; `git add -A && git commit -m "fix(<area>): resolve pipeline complaint (attempt N) [bot]" && git push` is pipeline-authored, so commit hygiene (RULES.md R2) holds regardless of what the agent does. If there's nothing staged after the protected-path revert (the agent made no usable change, or its only change was to a protected path that just got reverted), that's treated as a failed fix attempt, not a no-op success.
5. **The complaint references the attempt number, not a GitHub review ID.** Round-tripping a review ID into the commit message would need an extra API response field threaded through several layers for a marginal traceability gain; "attempt N" is simpler, still satisfies RULES.md R2.3 ("must reference the complaint they resolve"), and is exactly the number `decidePipelineOutcome` already reasons about.
6. **BLOCK now also posts the complaint.** Phase 3's BLOCK just failed the check silently from a human's perspective (findings only in the Action log). Since BLOCK can mean either "not auto-fixable" or "attempts exhausted," the PR now gets a request-changes review either way, so a human sees exactly what's wrong without digging through CI logs.

## Exit criteria (from the parent plan)

UC2 (flawed backend PR → security finding → fix agent patches it → re-review passes → merge; or after `max_fix_attempts` → block) works end-to-end against a local fixture, extending `tests/integration/pipeline-flow.test.ts`.

## Verification boundary

Same shape as Phases 2–3: `attempt-counter`, `complaint`, and the protected-path revert / commit-and-push logic are unit-tested with injected fakes (no real git/shell calls in the suite). The actual `cursor-agent` invocation in write mode is not live-tested here for the same reason Phase 3's reviewer wasn't — a live run costs real time and tokens and doesn't belong in a fast unit-test suite. What's new and load-bearing (attempt counting, protected-path revert, commit-message construction) is fully covered; the un-fakeable edge (spawning the real CLI) remains the same accepted gap as `runCursorAgent` in Phase 3.
