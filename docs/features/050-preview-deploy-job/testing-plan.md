# 050-preview-deploy-job — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Preview job

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK050-1 | decidePreviewDeploy deploys a green, previewable, seeded, non-fork PR | deploy: true | true | OK |  |  |
| TASK050-2 | It never deploys a fork, whatever else is true | deploy: false, reason names the fork | As expected | OK | A flag that said deploy for a fork is a flag somebody trusts one day |  |
| TASK050-3 | It respects preview.enabled: false | reason names preview.enabled | As expected | OK |  |  |
| TASK050-4 | It does not deploy a repository with no product apps, or one failing the contract | deploy: false in both cases | As expected | OK |  |  |
| TASK050-5 | It does not deploy a branch with no task folder, a missing folder, or a folder with no seed.sql | deploy: false; each reason says why (branch, glob, 'boot empty') | All three as expected | OK | ql-docs node 14: no fallback to no seed |  |
| TASK050-6 | The seed is matched case-insensitively, like the artifact check | Seed.SQL counts | true | OK |  |  |
| TASK050-7 | previewUpArgs builds the ql-proxy vector, branch as an argument | up --branch … --repo … --pr … --dir … --ttl … --protect | Exact match | OK | Never a shell string |  |
| TASK050-8 | --protect is omitted when the repository asked for an open preview | No --protect | As expected | OK |  |  |
| TASK050-9 | parsePreviewUpOutput reads the last URL-shaped line, and an optional token: line | url + null; url + token; null + null for no URL | All three | OK | The stdout contract the ql-proxy gate task has to satisfy |  |
| TASK050-10 | findPreviewInListing matches the row by URL, ignoring a trailing slash | project, minutesRemaining 118, expires, protected false | Exact match | OK |  |  |
| TASK050-11 | It is null for an unlisted URL, a non-list JSON, and non-JSON | null ×3 | null ×3 | OK |  |  |
| TASK050-12 | A never-expiring row reads as no minutes remaining | minutesRemaining null | null | OK |  |  |
| TASK050-13 | mcpEndpointFor builds the address from the first IPv4 on any network | http://172.19.0.4:8080/mcp; null with no address | As expected | OK |  |  |
| TASK050-14 | The summary prints URL, token and expiry together when a token was handed over | All three present, 'asks for it once', 'until 16:05 UTC' | All present | OK |  |  |
| TASK050-15 | The summary says plainly when the host does not gate previews yet | 'does not gate previews with a token yet', Cloudflare Access named, no 'Access token' | As expected | OK | Today's ql-proxy, until the browser gate lands |  |
| TASK050-16 | The summary tells 'locked but no token handed over' apart from both | 'did not hand its token', names the project | As expected | OK |  |  |
| TASK050-17 | The summary reports the MCP state and never prints the internal address | answering / not answering / could not be located; no 172.19.0.4 | As expected | OK |  |  |
| TASK050-18 | deployPreview: full sequence — up, list, compose ps, inspect — with the right env and args | 4 calls in order; QL_TASK_FOLDER=features/007-…, QL_MCP_ENABLED=true, GH_TOKEN=github.token; deployed with the MCP address | Exact match | OK | Real temp checkout; injected executor |  |
| TASK050-19 | deployPreview skips a fork silently, spawning nothing and posting nothing | skipped; 0 calls; no comment | As expected | OK |  |  |
| TASK050-20 | It skips a task folder with no seed, and a repository with no devops folder | skipped ×2 | As expected | OK | Decided again here, never trusted from the job condition |  |
| TASK050-21 | It fails naming QL_PROXY_HOME when it does not know where ql-proxy is | failed; reason names the variable | As expected | OK |  |  |
| TASK050-22 | It fails with ql-proxy's own stderr when up refuses, and posts nothing | failed; 'ttl.maxMinutes' in the reason; no comment | As expected | OK |  |  |
| TASK050-23 | It fails when up printed no URL, quoting what it printed | failed; output quoted | As expected | OK |  |  |
| TASK050-24 | The MCP wait is bounded by ready_timeout_seconds and the outcome published either way | 30s / 5s polls → 6–8 probes; deployed with mcpReady false; summary says 'not answering' | 7 probes; as expected | OK | Injected clock |  |
| TASK050-25 | A missing MCP container still reports the preview so the tester can say so | deployed with mcpUrl null; a warning names the service | As expected | OK |  |  |
| TASK050-26 | The token is printed beside the URL when ql-proxy handed one over | '`9f1c2d3e`' and 'asks for it once' | As expected | OK |  |  |
| TASK050-27 | lookupTaskFolder resolves by number, reports no-folder, and never reads the disk for a non-task branch | All three shapes | As expected | OK |  |  |
| TASK050-28 | The preview config block parses with defaults and refuses bad values | defaults; every key; refusals on enabled/ttl/path/port | As expected | OK |  |  |
| TASK050-29 | deploy-preview parses as a flagless command | { kind: 'deploy-preview' } | As expected | OK |  |  |
| TASK050-30 | pr-pipeline.yml parses with seven jobs and one-line if expressions | resolve, test, build, ql-pipeline, preview, preview-tester, preview-teardown | As listed | OK | PyYAML |  |
| TASK050-31 | The whole suite, typecheck, lint and neuron check stay green | 851 tests, 59 files | 851 passed | OK | 41 added on top of 049 |  |
| TASK050-32 | The harness validator output matches a clean main worktree line for line | Identical | Identical | OK |  |  |
| TASK050-33 | Live: a green PR on a product repository gets a URL, a summary and a tester run | preview and preview-tester checks; the Preview comment |  |  | Gate 3 — no repository on this fleet has apps/ + a devops folder + a ql-proxy runner yet |  |
| TASK050-34 | Live: closing that PR tears the stack down within seconds | preview-teardown runs; ql-proxy list no longer shows it |  |  | Gate 3 |  |
