# 048 — Summary

## What Shipped

`countFixAttempts` now takes a second source of evidence and returns the **larger** of the two:

| Source | Written by | True when |
|---|---|---|
| `[bot]`-suffixed commits | `runFix` | the pipeline is what commits |
| `FIX_ATTEMPT_MARKER` comments | the audit summary, on a FIX decision | always |

The marker is stamped inside the `FIX` branch `044` added — a comment posted exactly once per run that only announces a fix on a `FIX` decision, so it is one marker per attempt by construction. No new comment, no new API call, renders as nothing.

## The Defect

Under `agent.provider: ql_agents`, ql-agents clones onto its own host and commits with its own message. `runAgentsFix` writes no commit at all — its docstring says so, and it returns `ql-agents run <id>` as a label rather than a commit message.

So the counter read **0 on every run**: `attemptNumber` was always 1, `attemptsSoFar < maxFixAttempts` was always true, the fix dispatched, ql-agents pushed, the push retriggered. An unbounded loop, limited only by Actions minutes.

Introduced by `046` (which added the provider and did not revisit the counter) and widened by `047` (which let advisory findings dispatch, giving a review that raises a fresh nit each pass a path to loop on cosmetics). Never reachable on ql-desktop, which uses the default `cursor` provider — but live in `main` for anything that switched.

## Why Maximum, Not Sum

| | commits | markers | sum | max |
|---|---|---|---|---|
| cursor, one attempt | 1 | 1 | **2 — wrong** | 1 |
| PR older than the marker | N | 0 | N | N |
| ql_agents | 0 | N | N | N |

Summing halves the effective `max_fix_attempts` on the provider everything actually uses today. That is why the commit check is kept alongside rather than replaced.

## What Was Verified

| | |
|---|---|
| Full suite | **783 passed**, 56 files (was 775) |
| Marker-dependent cases red pre-fix | **3 failed, 13 passed** |
| No assertion relaxed | the 13 that held while commit-only semantics were reinstated |
| Restored source | byte-identical, confirmed by `diff` |
| Build / typecheck / lint / neurons | clean |
| Harness validator | identical to baseline |
| `dist/` | rebuilt and committed |

One pre-existing test was **tightened, not weakened**. `includes the reason as a blockquote for BLOCK, and only for BLOCK` asserted `not.toContain('>')` — a proxy that only held while the summary body carried no HTML comment. It now asserts `not.toMatch(/^>/m)`, line-anchored, which is what "carries no blockquote" actually means. The `-->` of a marker is not a quote.

Gate 3 is open and needs a repository configured for `ql_agents` to reach a second attempt. None exists — which is also why this was reasoned about rather than observed.

## The Trade That Is Recorded Rather Than Hidden

Reading zero when a marker exists restores the loop. The caller reads comments best-effort and passes an empty list on failure, falling back to commit evidence.

The alternative — treating an unreadable comment list as "attempts exhausted" — turns a transient GitHub outage into a blocked pull request. A pipeline that occasionally grants an extra attempt is better than one that refuses to fix because an API call failed. That is in the neuron's `owns`, not left to be rediscovered.

## Why Wasn't This Caught

`046` shipped a provider whose whole point was that the pipeline stops being the thing that commits, and the attempt counter's correctness rested on the pipeline being exactly that. The neuron even said so — *"the attempt count falls out of commit history the pipeline already fetches"* — a sentence that was true when written and silently stopped being true one commit later.

Nothing failed, because nothing runs `ql_agents` yet. The counter returns a number either way; only the number is wrong.

**Prevention:** the neuron now carries it as an `invariant` — the count is read from evidence this pipeline produced, never from what an agent did — so the next provider has to answer it.

## Version

`0.5.0 → 0.5.1` (PATCH). One optional parameter, one new exported constant, one extra line in a generated comment. Every existing caller compiles and the `cursor` provider counts exactly as before.
