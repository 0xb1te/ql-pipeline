# 050 — Deploy A Green Pull Request To A Temporary URL

## What

When a pull request is green and the review found nothing to fix, its devops stack is brought up on the preview host through ql-proxy, seeded from the branch's own `seed.sql`, and the pull request is told where to look, how to get in, and when it goes away. The automated tester that task `041` built and parked behind `if: false` is switched on from that job's output, and closing the pull request tears the stack down at once.

Three new jobs in the reusable workflow, one new command, and one new config block:

| Job | Runs on | Does |
|---|---|---|
| `preview` | `[self-hosted, ql-proxy]` | `ql-pipeline deploy-preview` — ql-proxy `up` on `infrastructure/docker/environments/devops/`, the MCP server located on the container network and waited for, one summary posted |
| `preview-tester` | `[self-hosted, ql-proxy]` | `ql-pipeline test-preview` against the address the deploy published — now live |
| `preview-teardown` | `[self-hosted, ql-proxy]` | ql-proxy `down --repo --pr` when the pull request closes |

## Why

A reviewer reads a diff. A person making the merge call — which, with `require_human_approval`, is every merge — should be able to open the thing, and an agent should be able to drive it. Task `041` built the tester and had nothing to point it at; task `049` made the folder it needs mandatory. This is the job in between.

## The Hook Point

`executeMergeDecision` returns `awaiting-human` when a MERGE verdict approves and labels `ready-to-merge` but leaves the merge to a person. That is the moment a green pull request is about to be judged, and it is the only moment `govern` sets the `deploy-preview` job output. A merged pull request is closed and has nothing to preview; every other outcome is something to fix first.

**Advisory findings do not gate the deploy.** The task brief asked for this to be decided explicitly. A MERGE verdict can carry `should` findings as inline comments; they never block a merge, so they must not block the preview that lets the person weighing them see the thing running. The verdict gates it, not the comment count.

## What The User Will See

- **On a green pull request in a product repository:** a `preview` check, and a comment — *Preview* — with the URL, the access state, the minutes left and the time it expires, and whether the application's MCP server answered. Then a `preview-tester` check driving the task's `MCP Cases` and reporting every failure in one comment.
- **On a red, blocked, fork or unpreviewable pull request:** nothing. No job, no empty summary.
- **On close:** the stack is gone within seconds instead of on the host reaper's next pass.
- **ql-proxy's own comment** still appears, from `github-actions[bot]`: *Preview: <url> … Cloudflare Access will ask who you are*. Two comments per preview until ql-proxy's `up` learns not to announce — see the plan for why it must arrive as the bot and not as a person.

## The Token

The summary prints the gate token in the clear beside the URL. It opens a demo of an unmerged branch on a throwaway stack and nothing else; the surface that could do harm — MCP — has no public route. A reviewer who has to fetch a secret from somewhere else does not open the preview.

**Today the token line reads differently.** ql-proxy does not protect previews yet — that is the sibling task *Authenticate previews behind a browser gate page* — so the summary says so plainly: *this host does not gate previews with a token yet; Cloudflare Access is the only lock.* The pipeline already passes `--protect` and already reads a `token: <value>` line off `up`'s output; when ql-proxy starts printing one, the summary starts carrying it, with no change here.

## What Will Not Change

- The four existing jobs, the verdict, the fixer and the merge path. `govern` gains one output and one log line.
- A repository with no product apps. ql-pipeline itself sets `preview.enabled: false` explicitly and has no `apps/`, so the dogfood run never reaches the job.
- The MCP surface is never publicly routed. The address the tester is handed is a container IP on the preview host, resolved with `docker inspect`, and the summary never prints it.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `features/050-preview-deploy-job-3e1d29`, cut from `features/049-preview-environment-gate-3e1d29` at `bb2fc1a` — stacked, because both edit `src/cli/govern-command.ts`. Merge `049` first.
- **Task:** [Deploy a green PR to a temporary URL and print its access token on the PR summary](https://app.notion.com/p/Deploy-a-green-PR-to-a-temporary-URL-and-print-its-access-token-on-the-PR-summary-3e1d2993e9a9814aa228e11fff47eb5e) on `QL Desktop-sprint-2`
- **Depends on:** [049](../049-preview-environment-gate/index.md) (the folder this hands to ql-proxy), the ql-docs preview environment contract (the folder's rules), and ql-proxy's browser gate (the token this prints). Built against all three; none of their rules are restated here.
- **Gate note:** Gate 3 needs a product repository with a valid devops folder, a self-hosted `ql-proxy` runner, and a green pull request. None exists on this fleet today — ql-desktop, ql-sprint and the rest have no `apps/`. Everything up to the runner is unit-tested with injected executors; nothing here is proven against a live ql-proxy. This PR itself touches `.github/workflows/`, so `checks / ql-pipeline` goes red by R4 and a person merges it — that is the guard working, not a failure.
