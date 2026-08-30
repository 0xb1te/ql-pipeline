# Task 013 — House-backed standards, and MCP-reachable maintenance commands

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Read engineering standards from `house-api` instead of a local `ql-docs` checkout, and make `doctor`/`init`/`upgrade` reachable by an AI agent over MCP — without changing `gate`/`govern` verdict logic or the reviewer-facing standards text. |

## Why

[009](../009-house-standards/plan.md) checked `ql-docs` out into `.standards/` with a `STANDARDS_TOKEN` at review time. That works, but it means every consumer repo's workflow needs a token scoped to a second private repo, and the checkout itself is a review-time step with its own failure modes. `house-api` already exists to serve this same content as a graph a client walks with a JWT — `ql-docs`'s own workflow and `ql-auth`'s client-credentials model are built for exactly this. Moving `govern`'s standards read onto that path drops the `STANDARDS_TOKEN` requirement and the checkout step entirely, in exchange for two new secrets (`HOUSE_API_URL`, plus the already-familiar `QL_AUTH_*` pair).

Separately, `doctor`/`init`/`upgrade` were CLI-only. An agent working inside a consumer repo (Cursor, an AI teammate) had no way to run them itself.

## The change

### `HouseStandardsReader`

A second implementation of the `StandardsReader` port (`src/standards/standards-resolver.ts`), alongside the existing local-filesystem reader:

- Calls `@0xb1te/house-client`'s `createSession`/`expand`/`advance`, plus its generic `mcpCall("house_read", …)` passthrough (the client has no typed "read one node" method — its own README documents the passthrough as the intended fallback).
- `StandardsReader.exists`/`.read` became `Promise`-returning. Every caller (`standards-resolver.ts`, `reviewer.ts`, `gate-command.ts`, `govern-command.ts`, and their tests) was updated to `await` them. The local-filesystem reader's behavior is unchanged — it just returns already-resolved promises now — so the reviewer prompt text for a given set of documents is byte-for-byte identical to before this change.
- **Only `govern` constructs a `HouseStandardsReader`.** `doctor`, `init`, and `upgrade` keep reading `.standards/` on disk (or skip standards entirely) exactly as before — they have no need for a live `house-api`, and giving them one would mean a laptop with no network can no longer run `doctor`.
- `house-standards-reader.ts`'s class doc explains the session-graph model in full, including the one real limitation it surfaces (below).

### The stage-2/stage-4/stage-6 grandchild-reachability bug

A live end-to-end run surfaced a real bug in `locate()`: it checked whether a document was the session's cursor or a **direct** child, then walked `next[]` — never recursing into a child's own children. `workflow/rules/stage-4-backend/backend/checklist.md`, `stage-4-backend/sql/checklist.md`, and `stage-6-tests/backend/checklist.md` are all *grandchildren* of their stage's entry node (children of that area's own `PROMPT.md`, which is itself a direct child of the entry), so all three came back `exists: false` against real `house-api` — meaning `govern`'s fail-closed check would escalate every backend-area PR to a human.

Fixed: `locate()` now genuinely descends into every direct child whose own directory is docPath's directory or an ancestor of it, and recurses from there. The naive version of this recursion (unfiltered fan-out across every child × every `next[]` candidate, up to a per-branch depth limit) was itself a real bug caught before merge — it made a single lookup issue an unbounded, exponential number of HTTP calls and hung. The fix threads one **shared, mutated-by-reference hop budget** (`MAX_HOPS = 4`, spent across the *entire* search tree, not per branch) plus a visited-cursor set through the recursion, so a single document lookup costs at most `MAX_HOPS` extra `expand`/`advance` calls no matter how many children or `next[]` candidates a route's session graph has.

This still does not make the three backend paths resolve today: confirmed live, `house-api`'s `expand()` re-returns the calling cursor's own view completely unchanged (same `cursor`, same `children`, same `next`) rather than the unlocked child's — a server-side gap in the session graph itself, not a client bug. `HouseStandardsReader` now genuinely attempts the recursion and will resolve such a document with no reader-side change the day `expand()`'s response reflects the unlocked node's own view; until then it correctly (and fail-closed-ly) reports the three paths missing rather than fabricating content. Reported to House as problem `d5a75cba-3ede-4f35-afed-0f2dfdde9dcb`. **Left out of scope for this task**, per direction, beyond this client-side fix.

### The `github_agent` route mismatch

`ql-auth`'s own README ("Authorities and recommended routes") lists `review:frontend`/`review:backend`/`review:infrastructure` as the recommended routes for a `github_agent` client. `HouseStandardsReader` never requests those — it only ever calls `createSession({ route: "stage:${N}" })`, because `house-api`'s session graph gates engineering-standards checklists by `stage:N`, not by review area. Confirmed live: a client minted with exactly `ql-auth`'s recommended routes gets a hard `403` on the first `govern` call; a client minted with `stage:N` routes succeeds.

This is `ql-auth`'s own recommendation being wrong for this specific consumer — fixing it there is out of scope for this task (the instruction was explicit: don't touch `ql-auth` or `house-api`). The fix that *is* in scope: [`docs/integration-guide.md`](../integration-guide.md) and [`docs/setup-guide.md`](../setup-guide.md) now tell the operator explicitly to grant `stage:1`–`stage:9` on the `QL_AUTH_CLIENT_ID` client, and explain why `ql-auth`'s generic table doesn't apply here — rather than pointing at that table at all.

### MCP bridge for `doctor`/`init`/`upgrade`

`src/mcp/server.ts` + `src/mcp/tools.ts`: a small stdio JSON-RPC server exposing three tools (`ql_pipeline_doctor`, `ql_pipeline_init`, `ql_pipeline_upgrade`), each spawning the equivalent CLI command as a **child process** and returning its stdout/stderr/exit code. Not a library call into the CLI's own command functions — process isolation means an agent-triggered `doctor` run can't corrupt the long-lived MCP server's own state, and the tool's output is exactly what a human would see running the command themselves. `@0xb1te/ql-kit`'s helper was considered and rejected: its process-spawning helper assumes a different working-directory/argv shape than this CLI's commands need.

### Harness bootstrap

`ql-pipeline` had no Knowledge Harness. Bootstrapped from scratch this task, following `ql-auth`/`ql-agents`'s structure: one `_ganglion.yml` + one neuron `.yml` per production source file, colocated `documentation/` folders, `brain.yml`/`tracts.yml`/`glossary.yml` at the repo root. `validate-harness.py --repo-root .` exits 0.

One finding needed an explicit resolution rather than a silent pass: `src/shared/documentation/types.yml` (the umbrella signal for `Area`/`CommitType`/`PipelineConfig`/etc. — pure shapes with no behavior) has an empty `receptors` list, same as `ql-sprint`'s `Types.yml`/`WireTypes.yml`. `validate-harness.py` reports this as an accepted ORPHAN (no afferent edge, no receptor) rather than a KH-5 "receptor described by no tract" — every unit in this surface imports these types at compile time, not through a runtime signal a tract could genuinely describe, so a fabricated receptor-with-no-real-tract would be worse than the accepted, precedented ORPHAN.

### npm → pnpm

`@0xb1te/house-client` and `@0xb1te/ql-auth-client` are pnpm **git-subdirectory** dependencies (`github:0xb1te/house#path:packages/client`-style specs). npm 11.12.1 (the version on the runner and on this machine) does not support that syntax — `npm install` on either dependency fails with `ENOENT`, looking for a `package.json` at the git checkout's root instead of the subdirectory. pnpm supports it natively. [`ql-sprint`](../../../ql-sprint) hit the identical problem installing the same two packages and made the identical migration — this is a precedented, load-bearing necessity for consuming either client package, not an unrelated convenience change.

In scope as a consequence: `package.json` gained `"packageManager": "pnpm@9.15.9"`, `package-lock.json` was removed in favor of `pnpm-lock.yaml`, `.github/workflows/{pr-pipeline,self-check,dogfood}.yml` were rewritten from `npm ci`/`npm run` to `pnpm install --frozen-lockfile`/`pnpm run` (plus pnpm's own setup-and-cache action step), and `vitest.config.ts` gained `resolve: { preserveSymlinks: true }` — pnpm's junction-based `node_modules`, combined with the `#`/`+`/`.` characters pnpm's git-dependency folder names contain, broke Vite/Vitest's default module resolution on Windows without it.

## Verification

`pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test` green — **425 tests across 38 files** (423 before this round of fixes, plus 2 covering the new descend-into-grandchild traversal).

Live, against a real `house-api` + `ql-auth` (JWKS mode, `QL_AUTH_STUB=false`):

- `workflow/rules/stage-2-mockup/checklist.md`, `stage-5-frontend/checklist.md`, `stage-8-deployment/checklist.md` — all resolve through `HouseStandardsReader` with content byte-identical to the local `ql-docs` checkout.
- `workflow/rules/stage-4-backend/backend/checklist.md`, `stage-4-backend/sql/checklist.md`, `stage-6-tests/backend/checklist.md` — all three correctly, and quickly (no hang), report missing — matching the confirmed `house-api` `expand()` limitation above, not a false positive and not a regression from the traversal fix.
- A client minted with `stage:2,4,5,6,8` succeeds on every `createSession` call above; a client minted with `ql-auth`'s recommended `review:*` routes gets `403` on the first call, confirming the docs fix in scope above is the correct one.
- `doctor`/`init`/`upgrade`, run through the built MCP server via a raw JSON-RPC request piped over stdio, stay local-only (no `HOUSE_*`/`QL_AUTH_*` calls) and return real CLI stdout from a genuinely spawned child process.

`python workflow/harness/assets/validate-harness.py . --repo-root .` (run from `ql-docs`) exits 0 against this repo, with the `types.yml` ORPHAN finding printed and accepted as documented above — not silently passed.
