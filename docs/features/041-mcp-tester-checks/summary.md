# 041 — Shipped

- **Date:** `2026-09-21`
- **Branch:** `features/041-mcp-tester-checks` merged into `main` as `ef509a6`
- **Deployed to:** consumer repositories on their next governance run — ql-pipeline is checked out by the reusable workflow at `inputs.ql-pipeline-ref`, so there is no deploy step of its own.

## What Shipped

- **A structural check.** The task folder a branch names must carry `testing-plan.xlsx` and `seed.sql`. Reported on every pull request from day one; **blocking only where a repository lists `task-artifacts` in `merge.required_checks`**.
- **A review criterion.** The AI review now judges whether the feature a PR adds is reachable over MCP and whether the test plan covers that surface — and treats an MCP server that is on by default, ignores a production signal, or is publicly routed as a `SECURITY` finding.
- **The tester itself.** A reader for the pinned `MCP Cases` sheet, a JSON-RPC MCP client, a runner, and a one-comment reporter, as a new `tester` region.
- **`ql-pipeline test-preview`**, a fifth CLI command.
- **A fifth CI job, `preview-tester`, committed switched off** (`if: false`), with a four-step comment saying exactly how to enable it.

**Structural changes a future task must know about:**

- `RequiredCheck` gained `task-artifacts`, and `GateStage` (`'build' | 'test'`) was **extracted as a positive type**. `GateReport.stage` was `Exclude<RequiredCheck, 'ai-review'>`, so the next non-gate check added would silently have widened what a gate report may claim to be.
- The `MCP Cases` column set is a contract shared with ql-docs `workflow/flows/testing-plan.md`. Both sides say so; change them together.
- `documentation/brain.yml` gained a `tester` region — a protected path, so this PR required human review under R4. It already did, touching `prompts/` and `.github/workflows/`.
- No new runtime dependency. The xlsx reader and the MCP client are written, not installed.

## What Was Verified

| Source | OK | KO | WARN |
|---|---|---|---|
| `testing-plan.xlsx` | `16` | `0` | `0` |

- **Open `KO` / `WARN` rows:** none.
- **Automated:** typecheck, lint and build green; 718 tests passing across 55 files (48 added here); harness validator output byte-identical to `main`, 24 pre-existing errors on both. The xlsx reader and plan parser are tested against the **real** openpyxl-produced template from ql-docs, not a hand-written fixture.
- **Verified in production by:** the run on this PR itself — with one gap named below. `preview-tester` resolved and **skipped**, which is the one thing that could not be proven locally.

## Commits

- `6105985` — `feat(infrastructure): check the task folder, and build the tester that reads it`
- `91a7e8f` — `Merge origin/main into features/041-mcp-tester-checks`
- `5f6b590` — `docs(docs): correct 041's test count for the post-merge suite`

## Post-Deploy Actions

- None defined by this project. A repository opts into blocking by adding `task-artifacts` to `merge.required_checks`; until then the check reports and does not block.

## Follow-Ups

- **The structural check did not actually run on this PR**, and that was a defect, not a quirk. It was wired in *after* the R4 protected-paths guard, which returns — so a governance pull request never reached it, and this one was the first to skip the check it shipped. Fixed in `bugfixes/042-artifacts-checked-after-r4`, where the check also moved into R4's own comment. First proven live on that PR's run: `task artifacts: complete in docs/bugfixes/042-…`.
- **`package.json` collided with `features/040`.** Both branches bumped `0.1.0` → `0.2.0` from the same base; identical text merges without a conflict and one bump disappears. Caught before merge and corrected to `0.3.0`. The same failure had already landed in ql-docs (`bugfixes/003-version-collision`) and been corrected afterwards.
- **`preview-tester` stays off** until the preview deploy job exists — its task is still in Backlog. Enabling it is four steps, written above the job.
