# 041 — Technical Plan

## Problem

ql-docs now requires every task folder to carry a machine-readable test plan and seed data, and every application to expose its features over MCP. None of that is worth anything until something reads it. This is that something, in two halves that ship together because the second is useless without the first: enforce the contract, then consume it.

## Neurons Read

`verdict.decision.taskProvenance` (the closest existing analogue — a pure check that manufactures a finding), `verdict.decision.requiredChecks` (the `must`/`should` opt-in pattern), `entrypoint.cli.governCommand` (where structural checks run, and where R4 does), `entrypoint.cli.command`, `entrypoint.main.main`.

## Scope

### In scope

| Unit | Change |
|---|---|
| `src/verdict/task-artifacts.ts` | **New neuron.** Branch → task folder, and the missing-artifact finding |
| `src/shared/types.ts` | `GateStage` extracted; `RequiredCheck` gains `task-artifacts` |
| `src/shared/gate-report.ts` | `stage` typed on `GateStage` rather than by exclusion |
| `src/cli/govern-command.ts` | `taskArtifactFindings`, run structurally before the review |
| `prompts/reviewer.md` | The MCP-reachability criterion |
| `src/tester/*` | **New region.** xlsx reader, plan parser, MCP client, runner/reporter |
| `src/cli/test-preview-command.ts` | **New neuron.** The `test-preview` command |
| `.github/workflows/pr-pipeline.yml` | The `preview-tester` job, gated off |

### Explicitly out of scope

- **Bringing a preview up.** Routing, the gate token, the reaper, the compose stack. That is the preview environment contract, still in Backlog, and it is why the job is off.
- **Enabling the job.** It ships `if: false` with the steps to switch it on written above it.
- **Making `task-artifacts` a default required check.** Opt-in per repository.
- **Backfilling artifacts** into existing task folders in this or any repository.

## Decisions

### `GateStage`, extracted rather than derived

`GateReport.stage` was `Exclude<RequiredCheck, 'ai-review'>`. Adding `task-artifacts` to `RequiredCheck` would have silently widened it to include a check that is not a job and produces no report. Naming the positive type closes that whole class of bug rather than adding a second exclusion that the next check has to remember.

### Advisory by default, blocking on opt-in

The brief says a missing artifact means fail. Shipping it that way would turn every pull request already open, in every consumer repository, red on the same day — and hand every author the same repair job in the same files.

`gateFindings` already solved this exact problem: `must` when the check is in `merge.required_checks`, `should` otherwise. Reusing that is not a softening — the finding appears on every pull request from day one, saying exactly what is missing. A repository opts into blocking when its folders are ready.

### A branch that names no task folder raises nothing

`dependabot/npm/lodash` has no task folder to be missing artifacts from. This check exists to make a task folder complete, not to force every branch through the task flow. A pull request with no task at all is already reported, advisorily, by `taskProvenance` — that is the right place for that question.

### Matched on `<kind>/NNN`, not the slug

ql-sprint appends the first six hex characters of a task's Notion page id to every branch it cuts, so `features/007-statistics-dashboard-a1b2c3` never equals the folder name. Matching the number is exact anyway: ql-docs gives each kind its own counter and never reuses one.

### No new dependency for xlsx or MCP

This repository has four runtime dependencies. A spreadsheet library would have been the largest by an order of magnitude, to read nine columns. The reader covers a stated, narrow slice — a ZIP central-directory walk, raw DEFLATE, the workbook, its relationships, the shared string table — and throws on anything outside it.

Two details in it are load-bearing, and both are tested against a real openpyxl workbook rather than a hand-written fixture:

- **Cells are placed by reference, never appended.** Empty cells are omitted from the XML entirely, so reading positionally shifts every column after the first blank — values would land in the wrong contract columns, silently.
- **It throws rather than returning an empty sheet.** Returning nothing would turn "unreadable plan" into "no cases", and a run that reports success it did not earn is the failure this whole feature exists to prevent.

The MCP client is the same reasoning: two JSON-RPC methods.

### One comment, enforced by structure

`runTestPlan` collects and returns; `formatTesterComment` renders; the command posts once. The rule is not a policy somebody has to remember — nothing in the tester can post, because nothing in it has a client.

### A `tester` region, which means a brain edit

`documentation/brain.yml` is a protected path, so this pull request requires human review under R4. It already did: it touches `prompts/` and `.github/workflows/`. The alternative was folding the tester into `verdict.decision`, which is documented as pure and explicitly excludes network effects — the tester has an `http-out` effector, so that would have been a false claim in the harness, which is the one state worse than having no harness.

## Contract Impact

- **`RequiredCheck` gains a value.** Config already validates against `REQUIRED_CHECKS`, so an unknown name still fails loudly; existing configs are unaffected because it is not in the defaults.
- **The `MCP Cases` column set is shared with ql-docs** `workflow/flows/testing-plan.md`. Changing it means changing the generator, the spec and this parser together; both sides say so.
- **`package.json` 0.2.0 → 0.3.0** (MINOR — feature). Originally 0.1.0 → 0.2.0, but PR #33 merged the same bump from the same base first. Both branches would have written the identical string, so git would have merged them without a conflict and this feature would have shipped with no version of its own — the failure ql-docs `bugfixes/003-version-collision` had to correct after the fact. Caught before merge here instead.
- **Harness:** one new region, one new ganglion, five new neurons, one new tract. Validator output is byte-identical to `main` (24 pre-existing errors, same breakdown).

## Verification

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` — green.
- `pnpm test` — **718 passing across 55 files**, re-run after merging `origin/main`. 48 of those tests are added here across 4 new files; the rest arrived with #33. (Before that merge it read 640 on `main` and 688 here.)
- The xlsx reader and plan parser are tested against the **real** committed template from ql-docs, not a hand-written fixture, so the contract is verified end to end.
- `python validate-harness.py .` diffed against a clean `main` worktree: identical output.
- `pr-pipeline.yml` parses, and `preview-tester` reads `if: false`, `needs: [resolve, ql-pipeline]`, `runs-on: [self-hosted, ql-proxy]`.

## Definition Of Done

The two checks live and reporting, the tester built and unit-tested, the job committed and provably unable to run, and no pull request that passed before this failing after it.
