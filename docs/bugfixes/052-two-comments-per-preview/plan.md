# 052 — Plan

## The Behaviour Being Changed

`src/deploy/preview-stack.ts#previewUpArgs` built `['up', '--branch', …, '--pr', n, '--dir', …, '--ttl', m, '--protect']`. `src/cli/deploy-preview-command.ts` read `QL_PREVIEW_ANNOUNCE_TOKEN` and handed it to the ql-proxy child as `GH_TOKEN`, and `.github/workflows/pr-pipeline.yml`'s `preview` job set that variable to `github.token`. ql-proxy's `up --pr` then posted its own announce comment as the bot, and the pipeline posted its summary: two comments.

## The Fix

- `previewUpArgs` adds `'--no-announce'` after the lifetime. `--pr` stays: teardown resolves the stack by repo and pull request.
- The command no longer reads `QL_PREVIEW_ANNOUNCE_TOKEN`; the child environment carries `QL_TASK_FOLDER`, `QL_MCP_ENABLED` and, when set, `QL_PROXY_CONFIG` — and no GitHub token.
- The workflow drops the variable and the job comment that justified it.

## Why Not Keep The Token As Belt And Braces

Because the belt was the problem. A token in the child's environment is a token every process ql-proxy spawns inherits — `docker compose` included — for a comment that is no longer posted. The narrower environment is the point.

## The Host Dependency

ql-proxy 0.1.0's argument parser treats an unknown `--flag` as an option that *needs a value* and exits 2, so a host that has not deployed 0.2.0 fails the deploy on the first run with that message. That is the right failure: loud, on the first preview, naming the flag. It is stated on `index.md` as the precondition for merging.

## Units

| Unit | Change |
|---|---|
| `src/deploy/preview-stack.ts` | `--no-announce` on the argv; the doc comment says why `--pr` stays |
| `src/cli/deploy-preview-command.ts` | `ANNOUNCE_TOKEN_VAR` and the `GH_TOKEN` mapping removed |
| `.github/workflows/pr-pipeline.yml` | `QL_PREVIEW_ANNOUNCE_TOKEN` and the announce paragraph removed from the `preview` job |
| `tests/deploy/preview-stack.test.ts`, `tests/cli/deploy-preview-command.test.ts` | The argv expectation; the child env asserted to carry no `GH_TOKEN` |
| `src/deploy/documentation/previewStack.yml`, `src/cli/documentation/deployPreviewCommand.yml` | The `owns` bullets rewritten |
| `docs/integration-guide.md` §8 | "Two comments per preview" paragraph removed |
| `docs/features/050-preview-deploy-job/summary.md` | The follow-up marked done, pointing here |

## Verification

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run neurons` — green.
- `pnpm test` — the two touched suites plus the whole run.
- Harness validator diffed line by line against the 050 head this stacks on: identical.
- `package.json` `0.7.0 → 0.7.1` (PATCH). `dist/` rebuilt and committed.

## Explicitly Out Of Scope

- Reading the token line or the `protected` flag differently: 050's parser already matches what ql-proxy 0.2.0 prints.
- Any change to ql-proxy.
