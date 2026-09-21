# 040 — governance verbs on the MCP · summary

**Shipped:** 2026-09-21 · **Version:** `0.1.0 → 0.2.0 (MINOR)` · **Branch:** `features/governance-verbs-on-mcp`

## What shipped

Four read-only tools on `ql-pipeline-mcp`, taking it from three tools to seven:

| Tool | Answers | Composes |
|---|---|---|
| `ql_pipeline_route` | which areas, rule files and gates a PR pulls in | `determineRoute`, `loadConfig` |
| `ql_pipeline_gate_reports` | what the gate jobs reported | `readGateReports` → `parseGateReport`, `mergeGateReports` |
| `ql_pipeline_verdict` | MERGE / FIX / BLOCK, and why that one | `gateFindings`, `isReviewRequired`, `countFixAttempts`, `decidePipelineOutcome` |
| `ql_pipeline_human_queue` | which PRs are parked on a person | `listPullRequestsByLabel` (new), `NEEDS_HUMAN_LABEL`, `READY_TO_MERGE_LABEL` |

They live in a new unit, `src/mcp/inspect.ts`, and run in-process. `src/mcp/tools.ts` keeps its
spawning behaviour untouched and composes `TOOLS` from both halves. `GithubClient` gained its
first repository-scoped read, `listPullRequestsByLabel`, at the edge per R3.4.

## The GAP A call: the CI verbs stay off, as a named carve-out

`gate` and `govern` are **not** exposed. `govern` merges, approves, comments and pushes fix
commits; `gate` runs the shell commands named in `gates:`. This repository's own config sets
`require_human_approval: true` so that no agent both changes code and merges it, and an MCP tool
calling `runGovern` would return that capability through another door.

The carve-out is recorded in four places that previously carried the wrong reason ("CI-triggered,
not maintenance actions"): the `runTool` docblock, the `server.ts` header, the
`mcp.server.tools` neuron invariant, and the README.

**It is not covered by the rule as written, and that is said out loud rather than glossed.**
GR-04's parity clause admits one exception — credentials — and closes the list. Nothing in
gate/govern emits a secret. GR-04 also says a capability the CLI has and the MCP lacks is a House
conversation (`problem`). That conversation **could not be opened**: House is read-only through
the ql-desktop MCP, and this task was commissioned with that MCP explicitly out of scope. The ask
is written down in `plan.md` for whoever can open it. The loop is not closed — saying so is the
point.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 51 files, **670 tests**, exit 0 (baseline 50 / 640 — 30 added) |
| `pnpm neurons` | "OK: every @signal has a documented entry" |
| ql-docs `validate-harness.py` | 23 pre-existing errors, identical to `main`; **zero added** |
| Built server driven over stdio | 6/6 JSON-RPC responses, all seven tools listed, no protocol corruption |

The last row mattered more than it looks: moving from spawn-only to in-process means the server
now imports the governance engine, and anything writing to stdout at import time would corrupt
the JSON-RPC stream. It was checked against the built binary, not inferred.

`testing-plan.xlsx` carries 37 rows across four tabs, all `OK`, self-tested.

## Versioning

`0.1.0 → 0.2.0 (MINOR)`. An MCP server's public API is its tool names, input schemas and return
shapes; this adds four and changes none, which is additive. `serverInfo.version` in
`src/mcp/server.ts` is hardcoded and moved in the same commit. The `1.0.0` suite cutover
(a README **Public API** section, `1.0.0`, a `v1.0.0` tag) is still pending for this repository
and was deliberately **not** done here — it is its own task, not a passenger on a feature branch.

## Deliberately left out

- **`formatAuditSummary`** — its input only exists part-way through a live govern run, so an
  agent could only feed it fabricated coverage structures.
- **`decideTaskProvenance`** — needs the ql-sprint task list over HTTP, dragging in the sprint
  base URL, the proxy fetch and their env. A sister-service integration, not an inspection of
  this engine.
- **Moving `readGateReports`** out of `cli/govern-command.ts` into `shared/gate-report.ts`, where
  it arguably belongs. Anti-collateral: it is imported where it lives.
- **The stale "399 tests across 34 files" line** in the README's Status section. It was already
  wrong before this task and sits outside the declared scope; correcting it is a one-line docs
  task, noted rather than taken.

## Gates

Gate 1 and Gate 2 were satisfied against the written brief that commissioned this task, which
declared the scope; no human was available in the loop to give a literal YES, and this ran
autonomously by instruction. **Gate 3 is not closed** and cannot be: the PR is open, unmerged by
instruction, and there is no production deploy to verify. The flow's three-YES contract is
therefore partially unmet, by construction rather than by omission.
