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
