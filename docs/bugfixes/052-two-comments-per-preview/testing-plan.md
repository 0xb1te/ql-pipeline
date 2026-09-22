# 052-two-comments-per-preview — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Preview job

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK052-1 | previewUpArgs carries --no-announce after the lifetime, and still carries --pr | up --branch … --pr 42 --dir … --ttl 120 --no-announce --protect | Exact match | OK | --pr stays for teardown by repo+pr |  |
| TASK052-2 | deployPreview spawns ql-proxy with no GitHub token in the child environment | env has QL_TASK_FOLDER, QL_MCP_ENABLED, QL_PROXY_CONFIG and no GH_TOKEN | As expected | OK |  |  |
| TASK052-3 | The deploy command exports no ANNOUNCE_TOKEN_VAR | Symbol gone; typecheck green | Gone | OK |  |  |
| TASK052-4 | The workflow's preview job sets no QL_PREVIEW_ANNOUNCE_TOKEN | grep finds nothing | Nothing | OK |  |  |
| TASK052-5 | The full suite, typecheck, lint and neuron check stay green | All green | 858 tests, 60 files; typecheck, lint, neurons green | OK | One argv case added |  |
| TASK052-6 | The harness validator matches the 050 head this stacks on | Identical | Identical, 24 pre-existing errors on both | OK | Diffed against the 050 head (20db282) |  |
| TASK052-7 | Live: a preview gets exactly one comment, the pipeline's summary | One comment |  |  | Gate 3 — needs a product repo, a runner, and ql-proxy 0.2.0 on the host |  |
