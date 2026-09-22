# 046 — Fix Through ql-agents, And Say Which Agent Has It

## What

Two things, and the second is the reason the first was worth doing.

**The fixer gained a provider.** `agent.provider: ql_agents` dispatches the complaint to ql-agents' `POST /v1/runs` instead of spawning `cursor-agent` in the governance job. `cursor` is untouched and still the default.

**Every finding thread is answered the moment an agent accepts it**, not when the attempt finishes:

> Picked up by agent `run-7` (attempt 1 of 3). It is running now and has every finding in this review, not just this one.

## Why It Matters

`runFix` was welded to the Cursor CLI. It spawns a binary, diffs its own working tree, reverts protected paths and commits what is left — every step of which is Cursor-shaped. Changing model vendor meant changing the fixer, and `openai_compatible` already could not fix at all for exactly this reason.

ql-agents already owns "run a coding agent against a branch" for the rest of the suite. Routing through it makes the vendor a descriptor on that side rather than a code path here.

The visible half is the reply. Bugfix `044` made the *summary comment* announce that a fix was starting; this puts the answer in the thread a reader is actually looking at, and names the run — a run id is something a person can look up, quote, or cancel. `replyForFinding` still posts afterwards saying what the attempt did, so a thread now reads: complaint → picked up by `run-7` → what `run-7` managed.

## The Guarantee This Weakens, Deliberately

**R4 protected paths are no longer reverted.** `runFix` reverts them in its own working tree *before* it commits. ql-agents clones into a worktree on its own host and pushes the branch itself, so this process never holds the diff — there is no moment at which a revert is possible.

Two things stand in instead:

1. The protected paths are stated in the brief, as paths the agent must not touch.
2. **R4 on the run that push triggers.** `touchesProtectedPaths` escalates the pull request to a human and refuses to auto-merge it, exactly as it would for a person who edited `rules/`.

So a violation is caught and blocked rather than silently merged — but the commit does reach the branch, which the `cursor` provider would not have allowed. That is a real difference and it is why `cursor` remains the default.

## Infrastructure

ql-agents was localhost-only and a governance run happens on an ephemeral GitHub Actions runner, so it had to be published: `https://agents.rvproxy.com`, `protected: true`, the same posture as `auth`, `house` and `sprint`. Two protections ride on every call — the agents hop's own ql-proxy edge secret says who may reach the address, and a ql-auth `client_credentials` bearer says what they may do once there.

Five variables, three of which most fleets already set: `QL_AGENTS_URL`, `QL_AGENTS_WORKTREE_BASE`, and the existing `QL_AUTH_URL` / `QL_AUTH_CLIENT_ID` / `QL_AUTH_CLIENT_SECRET`. Optionally `QL_AGENTS_PROXY_TOKEN` where the hop has its own secret rather than a shared `QL_PROXY_TOKEN`.

## What Will Not Change

- `cursor` is the default and behaves identically. Nothing about `runFix` was touched.
- The model still comes from `agent.fix.model` / `agent.model`, resolved at parse time exactly as before — it is forwarded as ql-agents' optional `model`, so one config line moves the vendor for either provider.
- Attempt counting, the verdict, `max_fix_attempts` and the merge path are untouched.
- A repository that asks for `ql_agents` without the credentials is **refused loudly** and escalated to a human, rather than silently falling back to Cursor.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `features/046-fix-through-ql-agents-3e3d29`, cut from `main` at `9059f85`
- **Task:** [Fix through ql-agents instead of calling cursor-agent directly](https://app.notion.com/p/Fix-through-ql-agents-instead-of-calling-cursor-agent-directly-3e3d2993e9a98158b637cd684dbdac5c) on `QL Desktop-sprint-2`
- **Merge order:** after [#39](https://github.com/0xb1te/ql-pipeline/pull/39), which takes `0.3.3`. Both edit the `version` line, so this rebases onto it.
- **Gate note:** Gate 3 needs a real `FIX` verdict on a repository configured for `ql_agents`, which no run has produced. Nothing here is proven against a live ql-agents beyond a reachable, protected exposure.
