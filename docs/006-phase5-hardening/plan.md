# Task 006 — Phase 5: Hardening

| | |
|---|---|
| **Status** | 🟢 Approved (part of the phase 1–5 build-out approved in Task 001) |
| **Parent** | [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7 "Phase 5 — Hardening" |

## Scope

- **`src/router/self-protection.ts`**: pure — `touchesProtectedPaths()`, checked in `main.ts` right after routing and before gates/review. A PR touching `.github/workflows/`, `.github/pipeline.config.yml`, or `.github/pipeline-rules/` (or ql-pipeline's own `rules/`/`prompts/`/`pipeline.config.yml` when dogfooding) always routes to `needs-human`, regardless of what the AI review would have said — RULES.md R4 enforced structurally, before the AI is ever consulted, not just as a post-hoc check on its output.
- **`src/shared/audit-summary.ts`**: pure — one summary comment per pipeline run (areas, gate results, finding count, decision), making the "full decision trail is reconstructible from the PR alone" guarantee (plan.md §6) actually true rather than aspirational.
- **`GithubClient` extensions**: `listChangedFiles` (for the self-protection check) and `postComment` (for the audit summary).
- **`.github/workflows/dogfood.yml`**: ql-pipeline governs its own PRs through the same reusable workflow any consumer calls, differing only in `config-path` (its own config lives at the repo root, not `.github/`) and a local `uses: ./...` reference. Carries the `concurrency` block every consumer is told to add.
- **`docs/integration-guide.md`**: the consumer-facing adoption doc referenced since Task 001 (RULES.md R6.4) — caller workflow snippet, required/optional secrets, branch protection guidance, `pipeline.config.yml` schema with every default spelled out, the rule-override mechanism, and what to expect on a PR (labels, comments, bot commits).
- **`tests/integration/chaos-safety.test.ts`**: the exit criterion itself, made explicit and checkable in one file rather than implicit across a dozen others.

## Exit criteria (from the parent plan)

"Chaos-test malformed commits, unfixable PRs, reviewer JSON garbage — all end in safe BLOCK states." Verified directly:
- **Malformed commits**: no commit or PR title matching the grammar → unroutable, gates/review never run.
- **Reviewer JSON garbage**: no JSON object anywhere in the response, or completely unparseable text (even after the retry) → the run fails rather than being treated as a pass. A reviewer that mutates its checkout despite read-only mode is never trusted even if its stated verdict looks clean.
- **Unfixable PRs**: a single not-auto-fixable finding blocks on attempt zero (no wasted fix cycle); an auto-fixable one still blocks once attempts are exhausted rather than looping forever; a mix of fixable and unfixable findings blocks the *whole* PR rather than partially fixing it.
- Two more safety properties folded into the same file since they're the same shape of guarantee: a config that fails to parse never falls back to a guessed default, and a gate whose command literally can't run (`exec` rejects) is a failure, not a silent pass.

## Design notes

1. **Self-protection runs before the AI, not as a check on its output.** An earlier design could have asked the reviewer to "flag if this touches protected paths" — rejected, because that makes the AI's judgment the enforcement mechanism for the one thing it must never be trusted to judge. `touchesProtectedPaths` is a plain string-prefix check on the PR's changed-file list, run deterministically before gates or review even start.
2. **The audit summary and the complaint review are deliberately separate.** The summary comment is unconditional, one per run, informational. The request-changes review (Phase 4) is conditional (only on FIX/BLOCK) and carries per-finding inline comments. Merging them into one artifact would make the summary noisy on the common MERGE path and would make the review harder to act on when it does matter.
3. **`dogfood.yml`'s existence is itself a test of the reusable-workflow design.** If calling `pr-pipeline.yml` from within the same repo (via a local `uses: ./...` reference) didn't work cleanly, that would be a sign the `workflow_call` contract from plan.md §4.8 was designed wrong. It didn't need any adjustment to work here — the only difference from a real consumer's caller is `config-path`, exactly as anticipated.

## Verification boundary

Same shape as every prior phase. `self-protection.ts` and `audit-summary.ts` are pure and fully unit-tested. `dogfood.yml` and the integration guide are correct against the documented contracts from Task 001's plan but not live-run (no authenticated `gh`, no real PR). `chaos-safety.test.ts` exercises the router, reviewer, verdict engine, gate-runner, and config loader together with fakes at the same I/O boundaries as every other phase.

## Status: build-out complete

This closes the phase 1–5 build-out from [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7. What exists now: commit parsing and routing (Phase 2), AI review with a grounded verdict and auto-merge (Phase 3), an auto-fix loop with a hard attempt limit (Phase 4), and self-protection plus consumer-facing documentation (Phase 5) — 200+ tests, `commit-parser`/`verdict` at 100% branch coverage per RULES.md R3.2, and two real bugs (a diff-parser edge case, a default-config mismatch for consumer repos) caught by testing rather than shipped. What's genuinely unverified: an actual live GitHub Actions run against a real PR, and a live `cursor-agent` review/fix invocation end-to-end — both require infrastructure (an authenticated `gh`, a real repo with a PR, Cursor API usage) outside what this environment could exercise, and are the natural next step before this governs real traffic.
