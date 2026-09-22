# 048 — Plan

## Confirmed Root Cause

`src/fixer/attempt-counter.ts`, pre-fix:

```ts
const BOT_COMMIT_HEADER = /\[bot\]\s*$/;
export function countFixAttempts(commitMessages: readonly string[]): number {
  return commitMessages.filter((m) => BOT_COMMIT_HEADER.test(m.split('\n', 1)[0]!)).length;
}
```

`runFix` (`src/fixer/fixer.ts:93`) writes that header itself:

```ts
const commitMessage = `fix(${area}): resolve pipeline complaint (attempt ${n}) [bot]`;
```

`runAgentsFix` writes no commit at all. Its docstring says so outright — *"ql-agents pushed the branch itself, so there is no commit message of this pipeline's making to report"* — and it returns `commitMessage: \`ql-agents run ${runId}\``, a label rather than a commit.

So with `agent.provider: ql_agents`:

1. `countFixAttempts` → 0 on every run
2. `attemptNumber` → always 1
3. `attemptsSoFar < maxFixAttempts` → always true
4. the fix dispatches, ql-agents pushes, the push retriggers, back to 1

### Is the invariant wrong, or is the code failing it?

The invariant was **underspecified**. The neuron said the count *"falls out of commit history the pipeline already fetches"* — true, and it stopped being true the moment a provider was added that commits for itself. `046` added that provider and did not revisit the counter.

`047` widened the exposure: advisory findings now dispatch, so a review raising a fresh nit each pass has a path to loop on cosmetics.

## The Fix

A second source of evidence, and the **larger** of the two wins.

`FIX_ATTEMPT_MARKER` (`<!-- ql-pipeline:fix-attempt -->`) lives in `shared/types.ts` beside `AUTOMATION_MARKER`, for the same reason that one does: two units read it and neither should import the other.

`formatAuditSummary` appends it inside the existing `FIX` branch — the one `044` added. That branch runs exactly once per run and only on a `FIX` decision, so it is **one marker per attempt by construction**. No new comment, no new API call, and it renders as nothing.

`countFixAttempts(commitMessages, commentBodies = [])` returns `Math.max(committed, announced)`.

### Why maximum and not sum

| | commits | markers | sum | max |
|---|---|---|---|---|
| cursor, one attempt | 1 | 1 | **2 (wrong)** | 1 |
| PR older than the marker | N | 0 | N | N |
| ql_agents | 0 | N | N | N |

Summing halves the effective `max_fix_attempts` on the provider that is actually in use everywhere today. The maximum is right in all three rows, which is why both sources are kept rather than the commit check being replaced.

### The failure mode that matters

Reading zero when a marker exists restores the loop. The caller reads comments **best-effort** — `client.listComments(pr).catch(() => [])`, the same endpoint the direction block at `:533` already uses — and an empty list falls back to commit evidence.

Deliberate, and recorded in `owns`: a pipeline that refuses to fix because GitHub was briefly unreachable is worse than one that occasionally grants an extra attempt. The alternative, treating an unreadable comment list as "attempts exhausted", turns a transient API failure into a blocked pull request.

`mcp.server.inspect#runInspectTool` takes a matching `commentBodies` parameter so the tool cannot report a different attempt count than the run it describes.

## Neurons

`fix.fixer.attemptCounter` — rewritten. Gains an `invariant` (the count is read from evidence this pipeline produced, never from what an agent did), `owns` for the maximum, the marker and the empty-list default, and `excludes` for the fetch. `shared.core.auditSummary` gains the stamping responsibility. `shared.core.types` names the new constant.

No signal added, renamed or removed — `countFixAttempts` gains an optional parameter (**KH-10** N/A).

## Test Plan

Eight cases. The ones carrying the design:

- **`counts a marked summary when no bot commit exists`** — the ql_agents path, the defect itself.
- **`counts one attempt when the same attempt left both a commit and a marker`** — the cursor path, and the reason it is `max` not `+`.
- **`still counts bot commits on a pull request older than the marker`** — no regression for in-flight PRs.
- **`bounds the loop: three marked attempts reach a cap of three`** — the whole point, stated as the cap.
- **`defaults the comments away`** — an existing caller compiles and behaves unchanged.

Red proven by reinstating commit-only semantics under the new signature: **3 failed, 13 passed**. The three are exactly the marker-dependent cases; the thirteen that held are the evidence no existing assertion was relaxed to fit. Restored and confirmed byte-identical.

One pre-existing test was tightened, not weakened: `includes the reason as a blockquote for BLOCK, and only for BLOCK` asserted `not.toContain('>')`, a proxy that only held while the summary body carried no HTML comment. It now asserts `not.toMatch(/^>/m)` — line-anchored, which is what "carries no blockquote" actually means. The `-->` of a marker is not a quote.

## Explicitly Out Of Scope

- **Making ql-agents write a `[bot]` header.** Considered and rejected: an agent may not comply, and a loop guard must not depend on the thing it is guarding choosing to cooperate.
- **A PR label as the counter.** Another writable surface to keep in step, for no gain over a comment the pipeline already posts.
- **MCP surface.** `runInspectTool` gains an optional input; no tool, schema or return shape is removed or changed. The `MCP Cases` sheet is present and empty.

## Version

`0.5.0 → 0.5.1` (PATCH). One optional parameter, one new exported constant, one extra line in a generated comment. Every existing caller compiles and every existing configuration behaves identically on the `cursor` provider.
