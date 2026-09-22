# 048-attempt-counter-blind-to-agents — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Attempt Counting

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK048-1 | A marked summary counts as an attempt when no bot commit exists | 1 for one marker, 2 for two | As expected | OK | The defect: under ql_agents the commit history says nothing, so this read 0 forever |  |
| TASK048-2 | One attempt leaving BOTH a commit and a marker counts as one | 1, not 2 | 1 | OK | Summing would exhaust max_fix_attempts at half its configured budget on the cursor provider |  |
| TASK048-3 | A pull request older than the marker still counts its bot commits | 2 for two bot commits and no markers | 2 | OK | No regression for in-flight PRs |  |
| TASK048-4 | When the sources disagree the larger wins | max of the two, both directions | 2 and 3 | OK |  |  |
| TASK048-5 | A comment without the marker is not an attempt | 0 | 0 | OK | An ordinary summary or a human comment must not count |  |
| TASK048-6 | An empty pull request, and one with only real commits, read zero | 0 for both | 0 and 0 | OK |  |  |
| TASK048-7 | The comment list defaults away, so an existing caller is unchanged | countFixAttempts([botCommit]) is 1 | 1 | OK | Keeps the signature change additive |  |
| TASK048-8 | Three marked attempts reach a cap of three | 3, so max_fix_attempts can trip | 3 | OK | The loop bound. Under ql_agents this was 0 on every run |  |
| TASK048-9 | The marker-dependent cases are red against commit-only semantics | The ql_agents cases fail; everything else holds | 3 failed, 13 passed | OK | The 13 that held are the evidence no existing assertion was relaxed |  |
| TASK048-10 | The restored source is byte-identical | diff reports no difference | BYTE-IDENTICAL | OK |  |  |
| TASK048-11 | A FIX summary carries the marker and a MERGE summary does not | One marker per attempt, by construction | Present on FIX only | OK | The summary is posted once per run and only announces a fix on a FIX decision |  |
| TASK048-12 | The blockquote assertion was tightened, not weakened | not.toMatch(/^>/m) - line-anchored, which is what 'no blockquote' means | Green; the '-->' of a marker is not a quote | OK | not.toContain('>') was a proxy that only held while the body had no HTML comment |  |
| TASK048-13 | Full suite, build, typecheck, lint, neurons and harness are clean | All clean; harness identical to the pre-change baseline | 783 passed, 56 files; harness identical | OK |  |  |
| TASK048-14 | A second fix attempt on a ql_agents repository is bounded | The cap trips at max_fix_attempts instead of looping | PENDING - needs a repository configured for ql_agents to reach a second attempt | PENDING | Gate 3. Also why the defect was reasoned about rather than observed |  |
