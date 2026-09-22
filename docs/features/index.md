# Features — rollup

Two lines per task, appended in each task's ship step and read in Step 0 of every future task.

This rollup starts at 040. Tasks 001–039 predate it and are discoverable only by folder
(`docs/NNN-*` for 001–024, `docs/features/NNN-*` from 025) or by branch name; they were not
back-filled here, because inventing rollup lines for work someone else shipped is a worse record
than an honest gap.

- `features/040-governance-verbs-on-mcp` — Put the pipeline's read-only governance verbs on its
  own MCP: route, gate reports, verdict and the needs-human / ready-to-merge queue, taking the
  server from three tools to seven. `gate`/`govern` stay off it as a named carve-out. Shipped as
  `0.2.0`.
- `features/041-mcp-tester-checks` — Made a task folder's test plan and seed data a structural
  check, added an MCP-reachability criterion to the AI review, and built the tester that drives a
  preview over MCP and reports every failure in one comment. The `preview-tester` job ships
  `if: false` until a preview deploy job exists. Shipped as `0.3.0`.

- `features/046-fix-through-ql-agents` — `runFix` was welded to the Cursor CLI: it spawns a
  binary, diffs its own tree and commits, which is why `openai_compatible` was review-only.
  `agent.provider: ql_agents` now dispatches to ql-agents' `POST /v1/runs` instead, and every
  finding thread gets `Picked up by agent <runId>` the moment the run is accepted rather than
  when it ends. `cursor` is untouched and still the default — deliberately, because ql-agents
  pushes from its own host, so protected paths can no longer be reverted before the commit and
  R4 on the triggered run is the only backstop. Do not make `ql_agents` the default without
  replacing that guard. Shipped in `0.4.0`.

- `features/047-advisory-findings-dispatch` — A `should` finding was computed, posted as an inline
  comment and then belonged to nobody: `runGovern` returns above `recordComplaint` and `runFix` on
  a MERGE, so no agent of any provider ever saw one. `decidePipelineOutcome` now returns FIX over
  auto-fixable advisory findings when nothing blocks, bounded by the same attempt cap and gated by
  the new `fixer.fix_advisory` (default on). Every guard falls back to MERGE, never BLOCK — an
  advisory finding must never start blocking a PR. Findings from a gate the repo left out of
  `required_checks` are excluded by their `gate#` prefix: those are advisory *by configuration*,
  and dispatching on them overrules the one explicit instruction the repo gave. A mixed set
  declines entirely, because FIX empties `advisoryFindings` and only the merge path posts it.
  Shipped in `0.5.0`.

- `features/049-preview-environment-gate` — The preview environment contract, enforced. A repository
  with `apps/*frontend*` or `apps/*backend*` must carry `infrastructure/docker/environments/devops/`
  with one `edge` entry service, no published host ports and an `env.example`; a product repository
  that fails any of that fails its pull request **before review**, structurally, after R4 and before
  the gates are read — a hard refusal, not a `must` finding, because a finding is weighed only after
  a review has been spent. `doctor` reports the same verdict. A repository with no product apps is
  unaffected, and the rules are cited from the ql-docs contract node, never restated. Shipped in
  `0.6.0`.
