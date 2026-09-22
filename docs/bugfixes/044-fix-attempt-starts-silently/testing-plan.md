# 044-fix-attempt-starts-silently — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Summary Comment

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK044-1 | actionsRunUrl builds the run URL from the Actions environment | https://github.com/0xb1te/ql-pipeline/actions/runs/42 | Exact match | OK |  |  |
| TASK044-2 | actionsRunUrl honours a GitHub Enterprise server rather than hard-coding github.com | https://ghe.example.com/a/b/actions/runs/7 | Exact match | OK |  | GITHUB_SERVER_URL exists for this; hard-coding the host would break every Enterprise consumer |
| TASK044-3 | actionsRunUrl returns null for an empty, partial, or empty-string environment | null in all three cases, never a half-built URL | null in all three | OK |  | A link built from absent values reads as a broken pipeline, not as a run-less summary |
| TASK044-4 | A FIX summary says a fix agent is starting, alongside the unchanged Decision line | Both the Decision line and a fix-agent sentence are present | Both present | OK |  | Decision: FIX was already posted before runFix; it just never read as an announcement |
| TASK044-5 | A FIX summary links the Actions run | The run URL appears in the comment body | Present | OK |  | The run page is the only place a cancelled attempt is visible |
| TASK044-6 | A FIX summary warns that a push cancels the attempt in flight | The body mentions cancellation | Present | OK |  | Consumers set concurrency.cancel-in-progress, so this is the case that matters most |
| TASK044-7 | A FIX summary with no run still announces the attempt | Fix-agent sentence present; no 'actions/runs', no 'undefined', no 'null' in the body | Announced, no broken link | OK |  | Fails if the null path interpolates anyway |
| TASK044-8 | MERGE and BLOCK say nothing about a fix agent | Neither verdict's comment mentions one | Neither does | OK |  | Fails if the announcement is appended unconditionally |
| TASK044-9 | The plumbing alone changes no behaviour | Suite green at 730, the count bugfix 043 left, before any rendering was written | 730 passed | OK |  | Proves the eight new tests are the only thing that moves the number |
| TASK044-10 | The eight new cases fail before the rendering exists | Red first, so they test the defect rather than the implementation | 4 failed of the audit-summary set; the 3 bootstrap cases passed on the plumbing commit | OK |  | actionsRunUrl was written in the inert step, so only the rendering cases could be red |
| TASK044-11 | The full suite is green after the fix | 730 plus the eight new cases | 738 passed, 55 files | OK |  |  |
| TASK044-12 | formatAuditSummary is still pure | No process.env read in audit-summary.ts; the URL arrives as an argument | Confirmed; env is read only in bootstrap.ts | OK |  | auditSummary.yml declares pure true with empty receptors and effectors |
| TASK044-13 | pnpm neurons and the harness validator report nothing new | New @signal documented; validator identical to the pre-change baseline | neurons OK; 90 errors before and after, same breakdown | OK |  | Baseline pre-exists on main |
| TASK044-14 | Build, typecheck and lint are green, with dist rebuilt | All clean; dist is committed in this repo | All clean | OK |  |  |
