# 050 — Technical Plan

## Problem

The tester from `041` is built, unit-tested, and parked behind `if: false` because nothing brings a stack up for it to reach. The reviewer-facing half is missing too: a green pull request in a product repository ends as a `ready-to-merge` label and nothing a person can open.

## Neurons Read

`merge.merger.merger#executeMergeDecision` (the `awaiting-human` outcome is the hook point), `entrypoint.cli.governCommand#runGovern` (where it is consumed, and what else is known at that moment), `entrypoint.cli.testPreviewCommand` (what the tester needs handed to it: `QL_PREVIEW_MCP_URL`), `tester.preview.mcpClient` (the readiness probe reuses it), `verdict.decision.taskArtifacts` and `verdict.decision.previewEnvironment` (the two facts the deploy decision keys off), `shared.core.exec` (why a second executor was needed). On the ql-proxy side: `cli.entry.main#run` (`up` prints only the URL; `--protect` is parsed as a boolean flag and ignored by `up`), `previews.app.list-previews` (the JSON row shape), `previews.adapters.gh-notifier` (announces through `gh` with whatever `GH_TOKEN` it is given), `previews.adapters.compose-runtime` and `host.adapters.system-host-shell` (compose inherits ql-proxy's environment, which is how `QL_TASK_FOLDER` reaches the seed mount).

## Scope

### In scope

| Unit | Change |
|---|---|
| `.github/workflows/pr-pipeline.yml` | `ql-pipeline` publishes `deploy-preview`; the dormant block is replaced by `preview`, a live `preview-tester`, and `preview-teardown` |
| `src/cli/deploy-preview-command.ts` | **New neuron.** The command: decide again, `ql-proxy up`, `list --json`, `docker compose ps` / `docker inspect`, bounded MCP wait, one summary, job outputs |
| `src/deploy/preview-stack.ts` | **New region and neuron.** The pure half: the decision, the argv, the two parsers, the address, the summary |
| `src/cli/govern-command.ts` | Sets `deploy-preview` on `awaiting-human`; `taskArtifactFindings` uses the shared folder reader |
| `src/verdict/task-artifacts.ts` | `lookupTaskFolder`, the one injectable reader three commands now share |
| `src/shared/types.ts`, `src/shared/config.ts` | The `preview` block: `enabled`, `ttl_minutes`, `protect`, `mcp.{service,port,path,ready_timeout_seconds}` |
| `src/shared/exec.ts` | `defaultArgvExecutor` — a program plus an argument vector, no shell |
| `src/cli/command.ts`, `src/main.ts` | `deploy-preview` |
| `templates/consumer/.github/workflows/pr-governance.yml` | Delivers `closed`, so teardown can fire |
| `templates/consumer/.github/pipeline.config.yml`, `pipeline.config.yml` | The block documented; this repo sets `enabled: false` explicitly |
| `docs/integration-guide.md` | Five checks, the preview section, the two repository variables |

### Explicitly out of scope

- **Protecting the preview.** ql-proxy's task. The pipeline passes `--protect` and reads a token line; until ql-proxy honours the flag and prints the token the summary says the address is not gated.
- **Suppressing ql-proxy's own announce comment.** Needs a flag on ql-proxy's `up`. Recorded as a follow-up below.
- **A doctor check for the runner or the variables.** A local CLI cannot know whether a `ql-proxy` runner is registered on the repository; `preview.enabled: false` is the escape hatch and the guide says when to use it.

## Decisions

### The verdict gates the deploy, not the comment count

The brief flagged that `awaiting-human` still posts advisory findings, so "MERGE verdict" and "no comments on the PR" differ, and asked for the choice to be written down. Chosen: **the verdict**. Advisory findings never block a merge; blocking the preview on them would deny the person weighing them the one thing that helps. And since `047`, a MERGE whose advisory findings are auto-fixable becomes a FIX first — so by the time `awaiting-human` is reached there is nothing left an agent would touch.

### The flag lives on the `ql-pipeline` job, not on `resolve`

`resolve` runs before anything is known. The verdict is known in `govern`, so `govern` says it, as a step output the job republishes. The `preview` job's `if:` reads `needs.ql-pipeline.outputs.deploy-preview == 'true'` and `needs.ql-pipeline.result == 'success'` — a run that set the flag and then failed on something later does not deploy.

### Decided twice, on purpose

`decidePreviewDeploy` runs in `govern` (to set the flag) and again in `deploy-preview` (before spawning anything). The job condition saves a runner; the second decision refuses to bring a stack up for a repository whose folder is not there. Both read the same four facts, so they cannot disagree.

### A command, not shell in the workflow

Reading the config, deriving the task folder, spawning ql-proxy with the right environment, parsing two outputs, resolving a container IP, waiting for a server, and composing a comment is a program. In YAML it would be untestable; as `deploy-preview` every step of it runs in a test with an injected executor, clock and probe. The workflow step is one line.

### An argv executor, because the branch name is pull-request content

`defaultCommandExecutor` runs a string through a shell, for config-defined commands with `&&`. A branch name interpolated into that string is a shell injection waiting for a branch called `x; rm -rf /`. `defaultArgvExecutor` runs a program with an argument vector and no shell, and every value from the pull request goes through it.

### The seed reaches compose through ql-proxy's environment

ql-proxy's shell adapter spawns `docker compose` with `{ ...process.env, ...request.env }`, so a variable in ql-proxy's environment reaches compose interpolation. The command sets `QL_TASK_FOLDER=features/007-statistics-dashboard` — the `docs/`-relative shape ql-docs node 14 names — and `QL_MCP_ENABLED=true`, so the contract's `../../../../docs/${QL_TASK_FOLDER}/seed.sql` mount resolves without ql-proxy knowing the task exists.

### ql-proxy announces as the bot, never as a person

`ql-proxy up --pr` comments the address through `gh`, and the pipeline needs `--pr` so `down --repo --pr` can find the stack on close. That comment carries no automation marker. Handed `GH_TOKEN` — a person's PAT — it would arrive as that person and, on a consumer with comment triggers, start another run, which deploys again, which comments again. Handed `github.token` it arrives as `github-actions[bot]`, which `resolve` declines by author type. So the job passes `QL_PREVIEW_ANNOUNCE_TOKEN: ${{ github.token }}` and the command maps it to `GH_TOKEN` for the child only. The cost is two comments per preview.

### The MCP address is a container IP, resolved on the host

The app's MCP server is not routed through `edge` — by contract — so it has no hostname. The runner is a process on the preview host, not a container on the compose network, so the service name does not resolve for it either. `docker compose -p <project> ps -q <service>` then `docker inspect` gives the container's IP on its networks, which a Linux host reaches directly on any bridge. That address goes to the tester and never into the summary.

### The tester runs whenever a stack came up, even without an address

If the MCP container cannot be found, `mcp-url` is empty and `test-preview` fails loudly on it — *the preview job and this one disagree about what was deployed*. Skipping the tester there would be exactly the quiet success `041` refuses.

### The readiness wait is bounded and its outcome published

`up -d --build` returns before the application listens. The command polls `tools/list` through the tester's own client every five seconds until it answers or `ready_timeout_seconds` passes, then publishes `mcp-ready` either way. A server that never came up is a finding the tester makes, not a reason to skip it.

### `preview.enabled` is an opt-out

A repository with the folder has said it can be previewed. The one case that needs the switch is a repository with the folder and no `ql-proxy` runner: a job waiting for a runner that never registers stays queued rather than failing, and nothing on the pull request says why.

### Teardown is its own job, off the event

`resolve` declines a closed pull request, and every other job keys off its `run` output. Teardown keys off `github.event.action == 'closed'` directly, with the fork guard spelled out, and calls ql-proxy `down --repo --pr` — the same shape as ql-proxy's own template. The scaffolded caller now delivers `closed`; an existing consumer adds it when it upgrades.

## Contract Impact

- **`PipelineConfig` gains `preview`.** Every existing config parses unchanged; the block defaults to enabled, protected, two hours, `backend:8080/mcp`. Every test that builds a full config literal gained the block.
- **The reusable workflow reports five checks**, not three, on a repository whose green pull requests reach the job; `vars.QL_PROXY_HOME` and `vars.QL_PROXY_CONFIG` are read from the caller.
- **`ql-proxy up` stdout is now read as a contract**: the last URL-shaped line, and an optional `token: <value>` line. Written into `deploy.preview.previewStack`'s `owns` so the ql-proxy task can satisfy it.
- **No MCP surface change** on ql-pipeline's own server.
- **`package.json` 0.6.0 → 0.7.0** (MINOR — feature), on top of 049's bump.
- **Harness:** one new region (`deploy`), two new neurons, a new tract, a new signal on `taskArtifacts` and on `exec`, edges into `deploy.preview` from `entrypoint.cli`. Validator output identical to `main` line for line.

## Verification

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run neurons` — green.
- `pnpm test` — **851 passing across 59 files**, 41 added on top of 049.
- `pr-pipeline.yml` parses; seven jobs; every `if:` is one folded expression.
- Harness validator diffed line by line against a clean `main` worktree: identical.
- Not proven live: no repository on this fleet has `apps/` plus a devops folder plus a `ql-proxy` runner. That is Gate 3 and is named on `index.md`.

## Follow-Ups

- **ql-proxy `up`**: honour `--protect` for previews and print `token: <value>` after the URL (the sibling task); grow a `--no-announce` so the pipeline's summary is the only comment.
- **A consumer to prove it on.** recocicla is the candidate the contract brief names, once its dev environment is flattened to the contract.

## Definition Of Done

A green pull request on a product repository gets a working URL, a summary with the access state and the expiry, and a tester run against its MCP server; a red, blocked or fork pull request gets nothing; closing tears it down; `preview-tester` is live.
