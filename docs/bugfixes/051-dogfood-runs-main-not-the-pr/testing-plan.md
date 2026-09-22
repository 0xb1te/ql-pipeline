# 051-dogfood-runs-main-not-the-pr — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Self Governance

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK051-1 | resolve exposes ql-pipeline-repo and ql-pipeline-ref outputs | Both read from steps.pr.outputs | Both present | OK | The one place the pull request is known on every event |  |
| TASK051-2 | When the caller is 0xb1te/ql-pipeline the engine is the pull request head; otherwise the pinned input | setOutput uses pr.head.repo.full_name / pr.head.ref for self, process.env.QL_PIPELINE_REF otherwise | As expected | OK | The input reaches the script through env:, never interpolated |  |
| TASK051-3 | Every 'Checkout ql-pipeline' step reads the resolve outputs and needs resolve | test, build, ql-pipeline, preview-tester: repository/ref from needs.resolve, path .ql-pipeline | All four | OK |  |  |
| TASK051-4 | Nothing but resolve reads the ql-pipeline-ref input | Exactly one line in pr-pipeline.yml, and it is the env: line | 1 reader | OK | A fifth checkout that reads the input again would be the defect back |  |
| TASK051-5 | dogfood calls the local workflow and passes no ql-pipeline-ref | uses ./.github/workflows/pr-pipeline.yml, config-path set, no ql-pipeline-ref | As expected | OK | Passing github.head_ref there covers pull_request only |  |
| TASK051-6 | The checkout step exists in all four engine jobs | Job list pinned so the per-step assertions cannot pass vacuously | 4 jobs | OK |  |  |
| TASK051-7 | The regression test is red against main's workflow files | The wiring cases fail; the already-true invariants hold | 4 failed, 2 passed | OK | The two that held are the job list and dogfood's shape |  |
| TASK051-8 | The restored workflow files are byte-identical | cmp reports no difference | BYTE-IDENTICAL | OK |  |  |
| TASK051-9 | Full suite, typecheck, lint, neurons and build are clean; dist unchanged | All clean; 0 content changes and 0 new files under dist after a rebuild | 816 passed, 58 files; dist identical | OK | No src change, so dist is not rebuilt in this pull request |  |
| TASK051-10 | Harness validator identical to a clean main worktree | Whole output diff is empty apart from the new provenance path | 24 error(s) on both; the only differing line is 'neurons with provenance 9 -> 10' | OK | Baseline built in a throwaway worktree of main, not the repo root, which carries a nested worktree the validator double-counts |  |
| TASK051-11 | Live: this pull request's own dogfood run announces the branch and checks it out | resolve notice 'ql-pipeline governs itself: running 0xb1te/ql-pipeline@bugfixes/051-dogfood-runs-main-not-the-pr'; every Checkout ql-pipeline step shows that ref | PENDING | PENDING | Gate 3, first half. A pull_request event runs the branch's YAML, so the fix proves itself on its own run |  |
| TASK051-12 | Live: the first governed pull request after the merge runs its own engine | Its govern log carries a line only its branch logs | PENDING | PENDING | Gate 3, second half. This run's engine is indistinguishable from main's because dist is identical |  |
