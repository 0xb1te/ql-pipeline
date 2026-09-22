# 046 — Plan

## What Was Asked For

Two things: dispatch findings to an agent through **ql-agents** rather than calling Cursor directly, so swapping provider later is a config change; and comment on the finding immediately with the agent's id, so a reader knows it is being worked. The fix stays on the same pull request. The model stays configurable from the project config.

## What Already Existed

Checked before building, because most of the model half was already there:

| Asked for | Already in the repo |
|---|---|
| Model configurable from the config file | `agent.provider`, `agent.model`, `agent.review.model`, `agent.fix.model` in `pipeline.config.yml`, resolved in `config.ts` at parse time |
| A place for the model to go | ql-agents' `POST /v1/runs` takes an optional `model` — a direct mapping |
| A per-finding reply | `replyForFinding`, but it posts *after* the attempt and names no agent |

So the build is: a provider, a client, a dispatch route, and an *earlier* reply. Not a new config system.

## The Contract

`POST /v1/runs` → `202 { runId }`

```
mode: 'implement' | 'clarify' | 'ask'
repo: { url, token? }
worktree: { baseDir, taskId }
branch, task: { id, name, description, taskType }, model?
```

`GET /v1/runs/:id` → `RunSummary`, `status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'`. Terminal is the last three.

## The Blocker, And Why It Was Not The One Expected

ql-agents listens on `localhost:4100` and a governance run happens on an ephemeral GitHub Actions runner. `proxyList` published `auth`, `house`, `sprint` and `qwen` — not `agents`.

A route through ql-sprint was considered first, since ql-sprint is already published, already authenticated from ql-pipeline, already holds an agents client (`adapters/agents/http-code-agent.ts`) and already receives `POST /v1/pipeline/notify` on every verdict. It was rejected: `notify` is a notification endpoint, and tunnelling a dispatch through it would put ql-sprint in the path of every fix for no gain, while the run id would have to make a second round trip to reach the comment.

Publishing ql-agents is the same shape as the three services already published, and `sprint-notifier.ts` is the template for calling one. Done: `https://agents.rvproxy.com`, `protected: true`.

## The Fix

**`src/fixer/agents-fixer.ts`** — new unit, sibling to `fixer.ts` rather than a branch inside it. `runFix` is left untouched, which is what keeps the default provider free of regression risk.

- `agentsFixerCredentialsFromEnv` — five variables, `undefined` unless all five are present.
- `buildAgentsBrief` — the complaint as a brief. Pure and separately exported so the weakened guarantee is inspectable in a test rather than buried in a request body.
- `runAgentsFix` — dispatch, `onDispatched(runId)`, poll to terminal or timeout, return the same `FixOutcome` shape `runFix` returns so the caller's three-case handling does not fork on provider.

**`src/shared/types.ts`** — `AGENT_PROVIDERS` gains `ql_agents`.

**`src/standards/house-credentials.ts`** — `ProxyHop` gains `agents`, with `QL_AGENTS_PROXY_TOKEN` and the existing `QL_PROXY_TOKEN` fallback.

**`src/reviewer/finding-reply.ts`** — `pickedUpReply`, separate from `replyForFinding` because they answer different questions at different times.

**`src/cli/govern-command.ts`** — routes on `config.agent.provider`, and passes an `announcePickup` callback that replies in every thread the complaint opened.

### Why `onDispatched` is a callback and not a return value

The run id exists at `202`, minutes before the outcome. A function that returned it could only do so by not waiting, which would lose the outcome reporting `replyForFinding` depends on. The callback is what lets one call both announce early and report late.

Failure inside it is swallowed on purpose: the run is executing by then, and failing the attempt over an unposted comment would be the messenger undoing the message — the same judgement `govern` already makes for every other best-effort reply.

### R4, and what is actually lost

`runFix` reverts protected paths in its own working tree before committing. ql-agents pushes from its own host, so this process never holds the diff. The brief names the paths; `touchesProtectedPaths` on the triggered run escalates to a human and refuses the auto-merge.

**This is weaker and is recorded as weaker** — in `agentsFixer.yml`'s `owns`, in `buildAgentsBrief`'s docstring, and in `index.md`. The violating commit reaches the branch, where under `cursor` it never would. It is why `cursor` stays the default rather than being replaced.

## Neurons

**Changing:** `fix.fixer.agentsFixer` (new, registered in the `fix.fixer` ganglion, whose `role` is rewritten to cover two providers); `review.reviewer.findingReply` (gains `pickedUpReply`); `entrypoint.cli.governCommand` (three new efferent edges — without them the validator reports three half-synapses, which is how the missing edges were found).

Three new `@signal` anchors ship in the same commit (**KH-10**), enforced by `pnpm neurons`.

## Test Plan

17 cases on `agents-fixer`, 4 on `pickedUpReply`. The ones carrying the design rather than the feature:

- **`announces the run id before the run has finished`** — asserts *order*, not just that the callback fired. The whole point is that it precedes the outcome.
- **`does not abandon a running agent because the pickup comment failed`** — `onDispatched` rejects; the outcome is still `committed`.
- **`reports a refused dispatch without ever announcing a pickup`** — a 400 must not produce a comment claiming an agent has it.
- **`is undefined when any one of them is missing`** — loops all five variables, so adding a sixth without adding it to the guard fails.
- **`states the protected paths`** — pins the one compensating control this provider has.
- **`gives up once the timeout passes`** — an injected clock, so a hung run cannot hang the job.

## Explicitly Out Of Scope

- **Making `ql_agents` the default.** It is weaker on R4; that trade is a repository's to make, not this task's.
- **`should` findings.** They still never reach a fixer of any provider — a `MERGE` verdict returns before the fix path. Changing that changes when things merge and is its own task.
- **Reviewing through ql-agents.** Only the fix moves. `openai_compatible` remains review-only.
- **MCP surface.** No tool, schema or return shape changes, so the `MCP Cases` sheet is present and empty.

## Version

`0.3.2 → 0.4.0` (MINOR). A new provider value, three new exported signals and five new environment variables — all additive, every existing config and caller unchanged. #39 takes `0.3.3`; both edit the same `version` line, so this rebases onto it.
