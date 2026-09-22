# 043-pipeline-reads-own-comments — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Direction Filter

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK043-1 | humanComments drops the pipeline's own summary and thread reply when a human token wrote them | Only the one real comment survives | 1 kept, body is 'use the existing helper instead' | OK |  | The defect. Both stamped comments have isBot false, exactly as GH_TOKEN produces them |
| TASK043-2 | humanComments keeps a person's comment written from the very same account | The operator's direction survives alongside the dropped chatter | 1 kept, body is 'ignore finding 2, that cast is deliberate' | OK |  | Fails if the fix over-reaches and filters by author instead of by marker |
| TASK043-3 | humanComments drops a stamped inline comment carrying path and line | Dropped like a conversation comment | [] returned | OK |  | The complaint review writes findings to the second endpoint, so they are stamped too |
| TASK043-4 | formatDirection returns the empty string on a PR only the pipeline has spoken on | '' so the fixer prompt renders no direction section at all | '' returned | OK |  | End to end. Pre-fix this returned the pipeline's own verdict attributed to @0xb1te |
| TASK043-5 | All four cases fail against the pre-fix source | Red before the fix exists, proving they test the defect | 4 failed, 6 passed in human-direction.test.ts | OK |  | Run before touching src/shared/human-direction.ts |
| TASK043-6 | The original isBot loop-guard test still passes | github-actions[bot] comments are still dropped; isBot was kept, not replaced | Passes unchanged | OK |  | Still the only signal on repos running the default GITHUB_TOKEN |
| TASK043-7 | Moving AUTOMATION_MARKER to types.ts changes nothing on its own | Suite green at the pre-existing count with no behaviour edit yet | 726 passed, 55 files | OK |  | Refactor proven inert before the behaviour change was written |
| TASK043-8 | The full suite is green after the fix | Pre-existing tests plus the four new ones | 730 passed, 55 files (726 + 4) | OK |  |  |
| TASK043-9 | human-direction.ts has no runtime import of github-client.ts | The pure unit does not pull in @actions/github to read one string | Imports AUTOMATION_MARKER from ./types.js; types.ts has no imports | OK |  | github-client.ts already imports PrComment type-only from human-direction, so a value import back would have made a real cycle |
| TASK043-10 | The harness validator reports nothing new | Same error count and breakdown as before the neuron edits | 90 errors before and after; KH-2 68, KH-3 16, KH-7 2, KH-1 2, KH-5 1 | OK |  | Baseline is pre-existing on main, not introduced here |
| TASK043-11 | Build, typecheck and lint are green | All three clean, and dist/ rebuilt since it is committed in this repo | All clean | OK |  |  |
