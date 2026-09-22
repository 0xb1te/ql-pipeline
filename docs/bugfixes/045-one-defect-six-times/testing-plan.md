# 045-one-defect-six-times — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Finding Dedupe

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK045-1 | Six passes each attribute one defect at one file:line to a different rule | One finding survives, and it is the first pass's attribution | 1 finding, rule docs.rules#state-what-is-not-covered | OK | Uses the six real rule ids from ql-desktop #103 |  |
| TASK045-2 | Two different rules broken on one line BY ONE PASS stay two findings | 2 findings | 2 findings | OK | The pre-existing assertion, preserved; only its name gained 'by one pass' |  |
| TASK045-3 | The same two rules split across two passes collapse to one | 1 finding | 1 finding | OK | The pair to TASK045-2: together they prove the pass boundary does the work |  |
| TASK045-4 | A defect two passes both saw is reported once | 1 finding | 1 finding | OK | Pre-existing assertion, unchanged in meaning |  |
| TASK045-5 | The same rule on different lines stays two, in one pass and across two | 2 findings in both groupings | 2 and 2 | OK | Pre-existing assertion, now asserted for both groupings |  |
| TASK045-6 | The same rule in different files stays two, in one pass and across two | 2 findings in both groupings | 2 and 2 | OK | Pre-existing assertion, now asserted for both groupings |  |
| TASK045-7 | A pass that repeated itself collapses | 1 finding | 1 finding | OK | Within-pass exact repeat still keyed on file:line:rule |  |
| TASK045-8 | First occurrence and order are preserved | [first, second] in order | As expected | OK | Pre-existing assertion, unchanged |  |
| TASK045-9 | An empty list and a list of one empty pass both pass through | [] for both | [] and [] | OK |  |  |
| TASK045-10 | The two cross-pass cases are red against pre-fix semantics | TASK045-1 and TASK045-3 fail when passes are flattened and keyed on file:line:rule | 2 failed, 16 passed | OK | Pre-fix semantics reinstated in place under the new signature, then restored |  |
| TASK045-11 | No pre-existing assertion was weakened to make room for the fix | All 16 preserved assertions still pass while the pre-fix semantics are reinstated | 16 passed alongside the 2 expected failures | OK | The evidence that the old tests were re-expressed, not relaxed |  |
| TASK045-12 | The restored source is byte-identical to the fixed source | diff reports no difference | BYTE-IDENTICAL | OK |  |  |
| TASK045-13 | The full suite is green after the fix | 738 plus the net new cases | 741 passed, 55 files | OK |  |  |
| TASK045-14 | Build, typecheck, lint, neurons and the harness validator are clean | All clean; harness identical to the pre-change baseline | All clean; 90 errors before and after, same breakdown | OK | Baseline pre-exists on main |  |
| TASK045-15 | A multi-pass review on a real PR collapses duplicates end to end | A PR whose review needs several passes reports each defect once | PENDING - needs a PR large enough to slice the standards into passes | PENDING | Gate 3. This repo's own PRs have been single-pass, which cannot exercise it |  |
