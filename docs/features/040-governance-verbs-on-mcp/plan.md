# 040 — governance verbs on the MCP

## The gap

This repository ships two binaries. `ql-pipeline` is a CLI of five commands over a governance
engine of ~30 inspectable methods. `ql-pipeline-mcp` is an MCP server that exposes three tools —
`ql_pipeline_doctor`, `ql_pipeline_init`, `ql_pipeline_upgrade` — every one of which is about
scaffolding a repo, and none of which is about governing a pull request.

So the engine's whole vocabulary — route, gate outcome, verdict, fix attempt, human queue — is
unreachable from an agent. The only way to ask "what did the pipeline decide about PR N" is to
re-run `govern`, and `govern` is not a question: it spends a model on a review, posts comments,
resolves threads, pushes fix commits, approves, labels, and merges. Asking it what it thinks
changes what it was asked about.

That is the asymmetry this task closes, and it closes it from the read side only.

## What this adds

Four tools, in-process, side-effect-free. They are deliberately the pipeline's own decision chain
in order, so that an agent can walk it the way the engine does:

| Tool | The question | Composes |
|---|---|---|
| `ql_pipeline_route` | which areas, rules and gates does this PR pull in, and why | `determineRoute`, `loadConfig` |
| `ql_pipeline_gate_reports` | what did the gate jobs leave behind | `readGateReports` → `parseGateReport`, `mergeGateReports` |
| `ql_pipeline_verdict` | given those gates and these findings, MERGE / FIX / BLOCK, and why that one | `gateFindings`, `isReviewRequired`, `countFixAttempts`, `decidePipelineOutcome` |
| `ql_pipeline_human_queue` | which pull requests are waiting on a person right now | `listPullRequestsByLabel` (new), `NEEDS_HUMAN_LABEL`, `READY_TO_MERGE_LABEL` |

### They call the same methods the CLI calls

This is the point, not an implementation detail. GR-04's parity clause requires the MCP path to
call "the same underlying method the window or the CLI calls" — a path built separately for
agents is a second behaviour that drifts, and the copy nobody watches is the one the agent gets.

So `ql_pipeline_gate_reports` imports `readGateReports` from `cli/govern-command.ts` rather than
walking the reports directory itself, even though walking a directory is six lines. A private
re-walk would have its own answer for a malformed report, and `govern`'s answer to that
(fail closed, because "the pipeline would otherwise merge a PR while genuinely not knowing
whether its tests passed") is exactly the behaviour an inspector must reproduce.

### Why in-process rather than spawning the CLI

The three existing tools spawn `dist/main.js` as a child process; `tools.ts` says outright that
the server "has no in-process code path". These four break that, deliberately:

- There is no CLI command to spawn. The read-only verbs are functions, not subcommands. Spawning
  would mean first inventing five new CLI subcommands — a second public API surface, larger than
  the one this task is about, and one the reusable workflow would then have to keep stable.
- Nine of the ten methods named in the brief are already pure and take plain data (R3.4 is why:
  "decision logic must be pure and testable without network or GitHub API access"). Pure
  functions are what an in-process tool is *for*.
- Spawning inherits the child's environment problem. `govern`'s in-process entry calls
  `createPipelineContext()`, which is not injectable and requires both `GITHUB_TOKEN` and an
  Actions webhook payload. The read-only tools need neither, except the one that genuinely talks
  to GitHub.

The new code therefore lives in its own unit, `src/mcp/inspect.ts`, so that the spawning
behaviour in `tools.ts` stays exactly what its neuron says it is, and the two dispatch paths are
readable apart.

### The one that does I/O

`ql_pipeline_human_queue` is the only tool here that reaches the network, and it needs a
`GithubClient` method that did not exist: every one of the client's sixteen methods takes a
specific pull request, so there was no repo-scoped query at all. `listPullRequestsByLabel` is
added at the edge (`shared/github-client.ts`), per R3.4 — the tool composes it, it does not
inline an Octokit call.

It reads `GITHUB_TOKEN` and says so plainly when it is absent, rather than throwing an unhandled
error at the JSON-RPC layer.

## The CI-verb carve-out

`gate` and `govern` are **not** exposed, and this is the deliberate, named exemption the task
called for rather than a gap left unexamined.

**Why.** `govern` merges to `main`, approves pull requests, posts comments and pushes commits to
a contributor's branch. `pipeline.config.yml` sets `require_human_approval: true` on this very
repository, and says why: "An agent that can both change the code and merge it leaves no moment
where a human sees the result." An MCP tool that calls `runGovern` would hand exactly that
capability back through a different door, on the repository every other governed repository
calls at `@main`. `gate` is milder but not harmless: it executes the shell commands named in
`gates:`, which makes it a remote-execution surface wearing a maintenance verb's clothes.

**What makes the carve-out survivable** is the read side landing in the same change. The reason
anyone wanted `govern` on the MCP was to find out what it would decide. That question now has
four answers that do not merge anything.

**Where it is recorded.** In the neuron invariant on `mcp.server.tools`, in the docblocks in
`mcp/tools.ts` and `mcp/server.ts`, in the README's MCP section, and here. All four previously
justified the exclusion as "CI-triggered, not maintenance actions"; all four now state the real
reason, which is that these verbs write.

**The honest part.** GR-04's parity clause admits exactly one exception — "A capability whose
job is handling credentials or secrets" — and explicitly closes the list: "One exception, and it
is the only one." Nothing in `gate` or `govern` returns a secret; `govern` *uses* credentials, it
never emits them. So this carve-out is **not** covered by the rule as written, and GR-04 says a
capability a CLI has and an MCP lacks is a House conversation (`problem`), not a local decision.

That conversation could not be opened from this task: House is read-only through the ql-desktop
MCP (catalog and entry reads only, no append and no conversation-open method), and this task was
commissioned with the desktop MCP explicitly out of scope. It is therefore **recorded here and
left open**, not silently resolved. The ask for that conversation, when someone can open it:

> GR-04's parity clause has one exception, for credentials. ql-pipeline needs a second one, for
> verbs that write to a repository from CI — merge, approve, comment, push, and arbitrary
> configured shell. Either the rule grows that exception, or ql-pipeline is out of compliance and
> should expose `gate`/`govern`. It should not stay undecided in a repository's own plan file.

## Neurons

**Read before planning** (KH-9: region `mcp` resolved from `brain.yml`, its ganglion, then the
blast radius up and down until it stopped growing):

- `documentation/brain.yml` — regions `mcp`, `verdict`, `routing`, `merge`, `shared`
- `documentation/tracts.yml` — `dispatch-an-mcp-tool-call`, `spawn-the-cli-as-a-maintenance-tool`
- `src/mcp/documentation/_ganglion.yml`, `tools.yml`, `server.yml`
- `src/verdict/documentation/_ganglion.yml`, `src/router/documentation/_ganglion.yml`,
  `src/merger/documentation/merger.yml`, `src/shared/documentation/` (gateReport, githubClient),
  `src/fixer/documentation/attemptCounter.yml`

**Invariant this change touches.** `mcp.server.tools` asserts "gate/govern are deliberately not
exposed here - they are CI-triggered, not maintenance actions an agent should invoke ad hoc".
It stays true — nothing here exposes gate or govern — but its *stated reason* was wrong, and is
corrected to the one above. The other neurons' invariants are untouched: no decision function
changes behaviour, and `recordVerdictLabel` remains the only writer of either label.

**To add:** `src/mcp/documentation/inspect.yml` (unit `src/mcp/inspect.ts`), registered in
`src/mcp/documentation/_ganglion.yml`.

**To change:** `src/mcp/documentation/tools.yml` (invariant reworded, `TOOLS` now composed),
`src/mcp/documentation/server.yml` and `_ganglion.yml` (role no longer "doctor/init/upgrade"
only), `src/shared/documentation/githubClient.yml` (new client method on the existing signal),
`documentation/brain.yml` (the `mcp` region's purpose is no longer "by spawning the already-built
CLI" alone), `documentation/tracts.yml` (a second MCP tract for the in-process path).

## Files

**In scope**

| File | Change |
|---|---|
| `src/mcp/inspect.ts` | new — the four descriptors and their in-process runner |
| `src/mcp/tools.ts` | `TOOLS` composes maintenance + inspection; `runTool` tries inspection first; docblock corrected |
| `src/mcp/server.ts` | docblock corrected (lines 3-4) |
| `src/shared/github-client.ts` | new `listPullRequestsByLabel` on `GithubClient` + its implementation |
| `tests/mcp/inspect.test.ts` | new |
| `tests/mcp/tools.test.ts` | extend the pinned tool list; keep it exact |
| `tests/mcp/server.test.ts` | extend the pinned tool list; keep it exact |
| `tests/shared/github-client.test.ts` | cover the new client method |
| `tests/merger/merger.test.ts` and any other full `: GithubClient` literal | add the new member |
| `README.md` | the MCP section lists seven tools and states the carve-out (R6.0, R6.1) |
| `package.json`, `src/mcp/server.ts` `serverInfo.version` | `0.1.0` → `0.2.0` |
| `documentation/*.yml`, `src/**/documentation/*.yml` | as listed under Neurons |
| `docs/features/040-*/` | this folder |

**Explicitly out of scope**

- `src/cli/govern-command.ts`, `src/cli/gate-command.ts`, `src/verdict/*`, `src/router/*`,
  `src/merger/*` — read and composed, never modified. No decision function changes behaviour in
  this task.
- Moving `readGateReports` out of `govern-command.ts` into `shared/gate-report.ts`, where it
  arguably belongs. It is imported where it lives. A move is a refactor with its own blast
  radius and is anti-collateral here.
- `formatAuditSummary` and `decideTaskProvenance`, both named in the brief. Cut deliberately:
  `formatAuditSummary` takes standards- and prompt-coverage structures that only exist part-way
  through a live govern run, so an agent could only feed it fabricated input; `decideTaskProvenance`
  needs the ql-sprint task list over HTTP, which drags in the sprint base URL, the proxy fetch and
  their env, and is a sister-service integration rather than an inspection of this engine. Both
  are follow-up tasks.
- The `1.0.0` suite cutover (a README **Public API** section, `1.0.0`, a `v1.0.0` tag).
  `versioning.md` lists ql-pipeline's cutover as pending; doing it inside a feature branch would
  be exactly the drive-by FL-10.3 forbids.

## Versioning

`0.1.0 → 0.2.0` (MINOR), in the same commit as the change. An MCP server's public API is its
tool names, their input schemas and the shape of what they return; this adds four tools and
removes or changes none, which is additive and backward compatible. The `GithubClient` interface
gains a member — that breaks any external implementer of the interface, but it is not part of a
declared public API (this repository has no `Public API` section yet, and `files:` publishes
`dist` for the CLI and MCP binaries), so it does not force a MAJOR.

`serverInfo.version` in `src/mcp/server.ts` is hardcoded and must move with it, or `initialize`
reports a version the package no longer is.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm test` green — baseline on this branch's merge-base is 50
  files / 640 tests, so the count only goes up.
- `pnpm neurons` green: every `// @signal` in the new unit has its documented entry.
- The two exact-equality assertions stay exact — extended to the full seven names, never loosened
  into a `toContain` or a length check. They are the thing that makes adding a tool a deliberate
  act.
- A test that asserts no inspection tool name collides with a maintenance one, and that `runTool`
  still answers an unknown tool with an error result rather than throwing.
- A test per tool for the unhappy paths that matter: an unroutable PR, a missing reports
  directory, a malformed gate report, and a human-queue call with no `GITHUB_TOKEN`.
- The side-effect claim is tested, not just asserted: the human-queue tool is driven with a fake
  client whose writing methods are `vi.fn()`s, and the test asserts none of them was called.
- `testing-plan.xlsx` in this folder, one tab per surface.
