# 041-mcp-tester-checks — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Pipeline Checks

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK041-1 | A branch naming a complete task folder raises no finding | taskArtifactFinding returns null | null | OK |  | tests/verdict/task-artifacts.test.ts |
| TASK041-2 | A folder missing seed.sql is reported, naming the file and its template | Finding names seed.sql and seed.template.sql | Both present in problem text | OK |  |  |
| TASK041-3 | Missing artifacts are `should` until a repo lists task-artifacts | severity is should without the opt-in, must with it | should / must respectively | OK | The whole point: shipping this must not turn in-flight PRs red |  |
| TASK041-4 | dependabot/* and other non-task branches raise nothing | taskFolderRefOf is null, no finding | null | OK |  |  |
| TASK041-5 | A ql-sprint-suffixed branch still resolves to its folder | features/007-slug-a1b2c3 resolves to 007 | {kind: features, number: 007} | OK |  |  |
| TASK041-6 | The xlsx reader reads a real openpyxl workbook, not a fixture | Sheets and the nine pinned headers read back exactly | Matched | OK |  | Reads the committed ql-docs template itself |
| TASK041-7 | An unreadable plan throws rather than reporting zero cases | TestPlanError | TestPlanError | OK |  | The failure the whole feature exists to prevent |
| TASK041-8 | An empty MCP Cases sheet parses as zero cases, not an error | [] returned, no throw | [] | OK |  | Absent and empty mean different things |
| TASK041-9 | A case failure becomes a finding carrying its reproduction | case id, call, input, expected and got all present | All five present | OK |  |  |
| TASK041-10 | blocker maps to must; major and minor map to should | [must, should, should] | [must, should, should] | OK |  |  |
| TASK041-11 | One broken tool does not cost the other results | The run continues and both outcomes are recorded | 2 outcomes | OK |  |  |
| TASK041-12 | An unreachable MCP server abandons the run and is itself a finding | abandoned.after set; a must finding is raised | after=1, must | OK |  | Not swallowed as an infrastructure hiccup |
| TASK041-13 | Exactly ONE comment, posted after the whole plan finishes | Nothing posted mid-run; one call at the end | 1 call | OK |  | The card's headline requirement |
| TASK041-14 | A pipe in a response cannot break the report table | The pipe is escaped | a \\\| b | OK |  |  |
| TASK041-15 | preview-tester cannot run | if: false, needs [resolve, ql-pipeline], runs-on [self-hosted, ql-proxy] | Confirmed by parsing the workflow YAML | OK |  |  |
| TASK041-16 | The harness validator finds nothing new | Output byte-identical to a clean main worktree | 24 errors both, same breakdown | OK |  |  |
