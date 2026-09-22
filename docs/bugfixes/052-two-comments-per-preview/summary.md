# 052 — Summary

## What Shipped

`ql-pipeline deploy-preview` now tells ql-proxy `--no-announce`, and the ql-proxy child is handed no GitHub token. The pipeline's summary — URL, access state, expiry, MCP state — is the only comment a preview gets.

| Piece | Change |
|---|---|
| `previewUpArgs` | `--no-announce` after the lifetime; `--pr` kept, because teardown resolves the stack by repo and number |
| `deploy-preview` command | `QL_PREVIEW_ANNOUNCE_TOKEN` and the `GH_TOKEN` mapping removed; the child environment is `QL_TASK_FOLDER`, `QL_MCP_ENABLED` and, when set, `QL_PROXY_CONFIG` |
| `pr-pipeline.yml` `preview` job | the variable and the paragraph that justified it removed |
| integration guide §8 | "Two comments per preview" became "One comment per preview", naming the ql-proxy 0.2.0 requirement |

## The Defect

050 handed ql-proxy `github.token` so its announce comment — which carries no automation marker — would arrive as `github-actions[bot]` and be declined by the resolve job's bot guard rather than start another run. That closed the loop hazard and left every preview with two comments. ql-proxy 0.2.0 (`0xb1te/ql-proxy#9`) added the flag that makes the token unnecessary; this passes it.

## What Was Verified

| | |
|---|---|
| Full suite | **858 passed**, 60 files (was 857; one argv case added) |
| Typecheck / lint / neurons | green |
| Harness validator | line-for-line identical to the 050 head this stacks on |
| No reference left | `grep -rn ANNOUNCE_TOKEN src tests .github docs/integration-guide.md` finds nothing |
| `dist/` | rebuilt and committed; version `0.7.0 → 0.7.1 (PATCH)` |
| Live | **not proven** — needs a product repo, a `ql-proxy` runner, and ql-proxy 0.2.0 on the host |

## The Precondition

ql-proxy 0.1.0's parser treats an unknown `--flag` as an option that needs a value and exits 2. A preview host that has not deployed 0.2.0 fails the deploy on its first preview, loudly and naming the flag. That is the right failure and the reason to upgrade the host before merging this.

## Decisions Worth Knowing Later

- **The child gets no token, rather than a scoped one.** A token in ql-proxy's environment is inherited by everything it spawns, `docker compose` included, for a comment that is no longer posted.
- **`--pr` was never about announcing.** It is what `preview-teardown` resolves the stack by; do not drop it alongside the token.
