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
