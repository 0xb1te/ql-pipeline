# 049-preview-environment-gate — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Pull request check

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK049-1 | requiresPreviewEnvironment applies to a repository with apps/*backend* | true | true | OK |  |  |
| TASK049-2 | It applies to a repository with apps/*frontend* | true | true | OK |  |  |
| TASK049-3 | It does not apply with neither, nor to an apps/ entry matching no area glob | false for [] and for apps/docs-site | false in both cases | OK | ql-pipeline itself is the [] case |  |
| TASK049-4 | It keys off the configured areas.paths, not a hardcoded convention | services/*api*/** applies; apps/shop-backend does not under that config | As expected | OK | The brief's 'keys off the area detection the pipeline already has', taken literally |  |
| TASK049-5 | A compose file following the contract raises no violation | [] | [] | OK |  |  |
| TASK049-6 | A missing compose file is reported alone | One violation naming the path | One, naming infrastructure/docker/environments/devops/docker-compose.yml | OK | Three sentences about one missing directory read as three problems |  |
| TASK049-7 | A compose with no service named edge is a violation | One violation saying so | 'no service named `edge`' | OK |  |  |
| TASK049-8 | Published host ports are refused, naming the service | One violation naming `db` | 'publishes host ports on `db`' | OK |  |  |
| TASK049-9 | env.example is required beside the compose file | One violation naming env.example | As expected | OK |  |  |
| TASK049-10 | Every violation is reported together, not the first found | Three violations for no-edge + ports + no env.example | 3 | OK |  |  |
| TASK049-11 | A compose file that is not YAML is reported, not treated as empty | 'not valid YAML' | As expected | OK |  |  |
| TASK049-12 | A compose with no services, or not a mapping, is reported | 'declares no `services`' / 'not a compose document' | Both as expected | OK |  |  |
| TASK049-13 | assessPreviewEnvironment is not-required / valid / invalid-with-violations | Each of the three shapes | All three | OK |  |  |
| TASK049-14 | The finding is must, not auto-fixable, on the compose path, citing the contract node | All four properties, every violation as a bullet | All present | OK |  |  |
| TASK049-15 | readPreviewEnvironmentSnapshot reads apps, compose text and env.example presence | apps/shop-backend, apps/shop-frontend; the compose text; false | Exact match | OK |  |  |
| TASK049-16 | The reader reads nothing when neither apps/ nor the compose exists | Empty snapshot; listDirs and read never called | As expected | OK |  |  |
| TASK049-17 | govern: a repository with no product apps raises nothing, whatever else it lacks | [] | [] | OK | Real temp checkout, the way CI reads it |  |
| TASK049-18 | govern: a product repository whose folder follows the contract raises nothing | [] | [] | OK |  |  |
| TASK049-19 | govern: a product repository with no devops folder raises one blocking finding citing the contract | must; names the compose path and stage-8-deployment | As expected | OK |  |  |
| TASK049-20 | govern: a malformed folder raises one finding carrying every violation | no edge, published ports and env.example all named | All three present | OK |  |  |
| TASK049-21 | The refusal comment says the PR fails before review and why nothing downstream can run | Contains 'fails before review', the finding, 'nothing to bring up', 'RULES.md R4' | All present | OK |  |  |
| TASK049-22 | The R4 escalation comment carries the preview finding beside the artifact findings | protectedPathsComment lists every finding passed | Covered by the existing 'carries every finding' test; runGovern passes the concatenated list | OK | By reading of runGovern: no unit harness for it in this repo |  |
| TASK049-23 | doctor: not-required passes and says so | pass, detail contains 'not required' | As expected | OK |  |  |
| TASK049-24 | doctor: an invalid folder fails with every violation and a pointer to the contract | fail; both violations in detail; fix names stage-8-deployment; worst is fail | As expected | OK |  |  |
| TASK049-25 | The whole suite, typecheck, lint and neuron check stay green | 810 tests, 57 files; all four green | 810 passed | OK | 26 tests added |  |
| TASK049-26 | The harness validator output matches a clean main worktree line for line | Identical; 24 pre-existing errors | Identical | OK |  |  |
| TASK049-27 | Live: the govern run on this pull request logs the not-required line | 'preview environment: not required — no apps/*frontend* or apps/*backend* directory' | Not observable on this PR: dogfood.yml passes no ql-pipeline-ref, so the govern step checks ql-pipeline out at main and ran 0.5.1's code against this branch. The log carries 'task artifacts: complete' and no preview line. | WARN | Gate 3 moves to the first governed run after #43 merges. Filed separately: dogfood should pass ql-pipeline-ref: github.head_ref so a PR exercises its own code. |  |
