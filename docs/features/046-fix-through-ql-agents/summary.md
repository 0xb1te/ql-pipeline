# 046 — Summary

## What Shipped

`agent.provider: ql_agents` dispatches the fix to ql-agents instead of spawning `cursor-agent` in the governance job, and every finding thread is answered the moment the run is accepted:

> Picked up by agent `run-7` (attempt 1 of 3). It is running now and has every finding in this review, not just this one.

| File | Change |
|---|---|
| `src/fixer/agents-fixer.ts` | new — credentials, brief, dispatch, poll |
| `src/shared/types.ts` | `AGENT_PROVIDERS` gains `ql_agents` |
| `src/standards/house-credentials.ts` | `ProxyHop` gains `agents` + `QL_AGENTS_PROXY_TOKEN` |
| `src/reviewer/finding-reply.ts` | `pickedUpReply` |
| `src/cli/govern-command.ts` | routes on provider; announces the pickup in every thread |

`runFix` is untouched. The new provider is a sibling unit, not a branch inside the existing fixer, which is what keeps the default free of regression risk.

Infrastructure: ql-agents was localhost-only and a governance run happens on an ephemeral Actions runner, so it is now published at `https://agents.rvproxy.com`, `protected: true` — the same posture as `auth`, `house` and `sprint`, behind both the hop's ql-proxy edge secret and a ql-auth bearer.

## What Was Verified

| | |
|---|---|
| Full suite | **759 passed**, 56 files (was 738; +21) |
| Build / typecheck / lint / neurons | clean |
| Harness validator | 90 errors, identical breakdown to `main` |
| ql-agents exposure | live, `protected: true`, port 4100, confirmed via `proxyList` |
| `dist/` | rebuilt and committed |

Three tests carry the design rather than the feature. `TASK046-8` asserts the *order* — the announcement precedes the first poll — because a pickup comment that arrives with the outcome is the thing this was built to avoid. `TASK046-14` rejects inside `onDispatched` and still expects `committed`. `TASK046-15` proves a refused dispatch announces nothing, because a comment claiming an agent has the findings when none does is worse than silence.

**Not verified against a live ql-agents.** The exposure is real and reachable; no dispatch has been made from a governance run, because none has reached a `FIX` verdict on a repository configured for this provider. `TASK046-24` is PENDING rather than implied, and `TASK046-22` — the loud refusal when credentials are absent — is covered by reading rather than by a test, since `runGovern` has no unit harness here.

## The Guarantee This Weakens

R4 protected paths are **no longer reverted** under this provider. `runFix` reverts them in its own tree before committing; ql-agents pushes from its own host, so this process never holds the diff.

What stands instead: the paths are named in the brief, and `touchesProtectedPaths` on the run that push triggers escalates to a human and refuses the auto-merge. A violation is caught and blocked — but the commit reaches the branch, which under `cursor` it never would.

That is why `cursor` stays the default. The trade belongs to a repository, not to this task.

## Why This Was Not Already Possible

`runFix` spawns a binary, diffs its own working tree and commits what it finds. Every one of those steps is Cursor-shaped, which is why `openai_compatible` was review-only — there was no seam at which a different agent could be substituted, only a different way of calling the same one.

Most of what looked like missing configuration already existed: `agent.provider`, `agent.model` and the per-phase `agent.review.model` / `agent.fix.model` have been in `pipeline.config.yml` all along, resolved at parse time, and ql-agents' submit takes an optional `model`. The gap was never the config; it was that the fixer had one implementation and no seam.

## Version

`0.3.2 → 0.4.0` (MINOR)

A new provider value, three new exported signals and five new environment variables — all additive. Every existing configuration parses unchanged and every existing caller compiles unchanged. #39 takes `0.3.3`; both edit the same `version` line, so this rebases onto it.
