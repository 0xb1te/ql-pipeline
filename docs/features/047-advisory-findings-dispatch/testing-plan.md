# 047-advisory-findings-dispatch — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Advisory Dispatch

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK047-1 | An auto-fixable review nit with nothing blocking dispatches an agent | FIX over the advisory findings, advisoryFindings emptied | FIX, 1 finding, advisory [] | OK | The behaviour this replaces: runGovern returned above recordComplaint and runFix on a MERGE |  |
| TASK047-2 | fixer.fix_advisory false restores the previous behaviour exactly | MERGE, findings carried as advisory | MERGE, 1 advisory | OK |  |  |
| TASK047-3 | Attempts spent merges rather than blocks | MERGE with the findings reported | MERGE, 1 advisory | OK | The invariant that matters most - a should finding never starts blocking |  |
| TASK047-4 | A non-auto-fixable advisory finding merges rather than blocks | MERGE | MERGE | OK | Spending an attempt on something no agent can fix changes nothing |  |
| TASK047-5 | One non-auto-fixable finding declines the whole set | MERGE, both carried as advisory | MERGE, 2 advisory | OK |  |  |
| TASK047-6 | A failed non-required gate is left alone | MERGE - it is advisory by configuration, not by judgement | MERGE, 1 advisory | OK | Dispatching would overrule the one explicit instruction the repo gave about that gate |  |
| TASK047-7 | A gate finding mixed in with a review nit declines the whole set | MERGE, both carried | MERGE, 2 advisory | OK | FIX empties advisoryFindings and the merge path is the only thing that posts it, so a split would report the gate nowhere |  |
| TASK047-8 | The blocking path is untouched - a must finding still decides alone | FIX over the must finding, the advisory one riding along | FIX, must only, 1 advisory | OK |  |  |
| TASK047-9 | An advisory fix is still allowed one short of the limit | FIX | FIX | OK |  |  |
| TASK047-10 | A pull request with no findings at all still merges | MERGE | MERGE | OK |  |  |
| TASK047-11 | fix_advisory defaults to on | config.fixer.fixAdvisory is true when the key is absent | true | OK |  |  |
| TASK047-12 | fix_advisory can be turned off | false when the key says so | false | OK |  |  |
| TASK047-13 | A non-boolean fix_advisory is refused, not coerced | Throws naming the key | Throws | OK |  |  |
| TASK047-14 | Every pre-existing verdict assertion keeps its meaning | The advisory-only case already used autoFixable false, so the new guard declines it unchanged | All pre-existing verdict tests pass | OK | The existing suite therefore validates that the new default breaks nothing |  |
| TASK047-15 | The required-checks test that found the gate distinction passes unchanged | 'a failed non-required gate rides along as advisory and still merges' is green | Green, unmodified | OK | It went red against the first implementation, which is how the distinction was found |  |
| TASK047-16 | Full suite, build, typecheck, lint, neurons and harness are clean | All clean; harness identical to the pre-change baseline | 775 passed, 56 files; harness identical | OK |  |  |
| TASK047-17 | A governed PR whose review raises only advisory findings dispatches an agent | Threads carry a pickup reply and a fix attempt runs | PENDING - ql-desktop #103 reopened after this merges is the intended check | PENDING | Gate 3 |  |
