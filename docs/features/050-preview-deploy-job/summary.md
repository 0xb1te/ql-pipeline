# 050 — Summary

## What Shipped

A green pull request in a product repository now gets a preview, and the tester `041` parked gets something to reach.

| Piece | What it does |
|---|---|
| `govern` | Sets the `deploy-preview` job output on an `awaiting-human` verdict, for a repository whose devops folder satisfies the contract and whose branch names a task folder with a seed, never for a fork |
| `preview` job | `ql-pipeline deploy-preview` on `[self-hosted, ql-proxy]`: ql-proxy `up` on `infrastructure/docker/environments/devops/` with `QL_TASK_FOLDER` set so the database boots from the branch's `seed.sql`; the MCP container's IP resolved with `docker inspect`; `tools/list` polled until it answers or the timeout passes; one summary with the URL, the access state, the expiry and the MCP state |
| `preview-tester` job | Live. Keys off the preview job's outputs and drives the task's `MCP Cases` against the address it published |
| `preview-teardown` job | ql-proxy `down --repo --pr` when the pull request closes; the scaffolded caller now delivers `closed` |
| `preview` config block | `enabled` (an opt-out), `ttl_minutes`, `protect`, `mcp.{service,port,path,ready_timeout_seconds}` |

## What Was Verified

| | |
|---|---|
| Full suite | **851 passed**, 59 files (was 810; 41 added) |
| Typecheck / lint / neurons | green |
| Workflow | parses; seven jobs; every `if:` one folded expression |
| Harness validator | line-for-line identical to a clean `main` worktree |
| `dist/` | rebuilt and committed |
| Live | **not proven.** No repository on this fleet has `apps/` plus a devops folder plus a `ql-proxy` runner. Everything up to the runner runs in tests with an injected executor, clock and probe (`TASK050-18` to `-26`); `TASK050-33` and `-34` are Gate 3 |

## Decisions Worth Knowing Later

- **The verdict gates the deploy, not the comment count.** Advisory findings never block a merge, so they never block the preview. Recorded because the brief asked for it explicitly.
- **Decided twice.** `decidePreviewDeploy` runs in `govern` to set the flag and again in `deploy-preview` before spawning anything. Do not remove the second on the grounds that the job condition already checked — it is what refuses to bring a stack up for a repository whose folder is not there.
- **ql-proxy announces as `github-actions[bot]`, never as a person.** Its comment carries no automation marker; as a person's it would start another run on a consumer with comment triggers. `QL_PREVIEW_ANNOUNCE_TOKEN` is `github.token` and is the only token the child gets. Two comments per preview is the price until ql-proxy grows `--no-announce`. *Superseded by bugfix 052: ql-proxy 0.2.0 has the flag, the deploy passes it, and the child gets no token at all.*
- **The MCP address is a container IP and never appears on the pull request.** The surface behind it can manage every user; the summary says whether it answered and nothing else.
- **The tester runs even when the address is empty**, and fails loudly on it. A skip there would be the quiet success `041` refuses.
- **`ql-proxy up` stdout is read as a contract**: the last URL-shaped line, and an optional `token: <value>` line. Written into the `previewStack` neuron's `owns` so the ql-proxy gate task knows what to print.

## Follow-Ups

- **ql-proxy**: honour `--protect` on `up` and print `token: <value>` (the sibling task, *Authenticate previews behind a browser gate page*); add `--no-announce`. *Done in ql-proxy 0.2.0 (#9); the pipeline side is bugfix 052.*
- **A consumer to prove it on**, once one has a contract-shaped devops folder and a registered runner.
- Stacked on 049 (PR #43). Merge that first, then retarget this to `main` — see the memory on stacked pull requests.
