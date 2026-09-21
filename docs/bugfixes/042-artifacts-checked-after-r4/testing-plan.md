# 042-artifacts-checked-after-r4 — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Governance Run

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK042-1 | The artifact check runs before the R4 guard | taskArtifactFindings is called above the early return | Confirmed by reading runGovern; the call precedes the guard | OK |  |  |
| TASK042-2 | An R4 escalation carries the artifact finding in its comment | The body contains both the R4 sentence and the missing filename | Both present | OK |  | The defect: the escalation returns before anything else could report it |
| TASK042-3 | A complete task folder leaves the R4 comment unchanged | Body is the R4 sentence alone, with no 'Also worth seeing' section | R4 sentence only | OK |  |  |
| TASK042-4 | Every finding travels, not just the first | Two findings both appear in the composed body | Both present | OK |  |  |
| TASK042-5 | taskArtifactFindings reports a folder missing both artifacts | One `must` finding naming testing-plan.xlsx and seed.sql | Both named | OK |  | Run against a real temp directory, not a mock |
| TASK042-6 | A ql-sprint-suffixed branch still resolves to its folder | features/007-slug-a1b2c3 finds docs/features/007-*/ | Resolved, no finding | OK |  |  |
| TASK042-7 | A branch naming no task folder still raises nothing | dependabot/npm/lodash produces no finding | [] | OK |  | Unchanged by this fix |
| TASK042-8 | R4 still escalates, labels and fails exactly as before | Only the comment body differs; the label and exit code are untouched | Unchanged | OK |  |  |
| TASK042-9 | The harness validator finds nothing new | Output byte-identical to a clean main worktree | 24 errors both, same breakdown | OK |  |  |
