# 052 — Every Preview Got Two Comments, And A Token It Did Not Need

## What

The preview deploy handed ql-proxy a GitHub token so that ql-proxy's own `gh pr comment` announce would arrive as `github-actions[bot]`, which the resolve job's bot guard declines. That kept the unmarked comment from starting another pipeline run, but every preview still got two comments: ql-proxy's *Preview: … Cloudflare Access will ask who you are*, and the pipeline's own summary with the URL, the token and the expiry.

ql-proxy 0.2.0 (`0xb1te/ql-proxy#9`) gave `up` a `--no-announce` flag. The deploy now passes it, and the token plumbing — `QL_PREVIEW_ANNOUNCE_TOKEN` in the workflow, the `GH_TOKEN` mapping in the command — goes away. The pipeline's summary is the only comment, and the ql-proxy child gets no GitHub token at all.

## Why It Matters

Two comments per preview was noise a reviewer had to read past, and the token was plumbing that existed only to neutralise a comment nobody wanted. Removing both is smaller than either: one argv entry in, two variables out.

The loop hazard that the token guarded against is closed differently now — ql-proxy does not post, so there is no comment to decline.

## What Will Not Change

- `--pr` stays on the argv. ql-proxy records the pull request on the stack so `preview-teardown` can resolve it by repo and number on close; announcing was never why it was passed.
- The pipeline's summary is unchanged in content.
- Nothing else about the deploy: the devops folder, `QL_TASK_FOLDER`, the MCP wait, the outputs.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/052-two-comments-per-preview-3e1d29`, cut from `features/050-preview-deploy-job-3e1d29` at `20db282` — stacked on the re-opened 050 (PR #46), because it edits the deploy that PR introduces. Merge #46 first, then retarget this to `main`.
- **Depends on:** ql-proxy 0.2.0 running on the preview host. 0.1.0's parser treats an unknown `--flag` as an option that needs a value and exits 2, so a host that has not deployed 0.2.0 fails the deploy loudly on the first preview, naming the flag, rather than announcing twice. Upgrade the host before merging.
- **Gate note:** Gate 3 needs a product repository with a devops folder and a `ql-proxy` runner on 0.2.0, the same condition 050 is waiting on. Everything up to the runner is covered by the unit tests.
