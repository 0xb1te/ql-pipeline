# 044 — Plan

## Confirmed Root Cause

Two facts, both at file/line level.

**1. The pre-fix signal exists and is illegible.** In `runGovern`:

- `src/cli/govern-command.ts:630` — `await client.postComment(pr, formatAuditSummary({...}))`
- `src/cli/govern-command.ts:800` — `const fixOutcome = await runFix(...)`

The summary is posted 170 lines before the agent is spawned. What it says about the FIX case is exactly one line, produced by `src/shared/audit-summary.ts`:

```ts
`**Decision:** ${input.decision.kind} (attempt ${input.attemptNumber} of ${input.maxFixAttempts})`
```

That names a verdict. It does not say an agent is running, and nothing else is written to the pull request until `answerThreads` fires after the attempt completes.

**2. The run is not a value this surface has.** `grep -rn "GITHUB_RUN_ID\|GITHUB_SERVER_URL" src/` returns nothing. The pipeline cannot link the run it is executing in because it never reads it.

That second point is the actual root cause; the first is the symptom. It is also why no test caught it — there is no way to assert the absence of a field nobody passed.

### Why the cancellation warning is part of the same fix

`templates/consumer/.github/workflows/pr-governance.yml:15-17` sets `concurrency.cancel-in-progress: true`, commented in-template as *"A new commit cancels the in-flight run for the previous one, including a stale fix-loop attempt."* So a push during a fix attempt kills it, and the only evidence is the cancelled run. Announcing an attempt while omitting that it can be killed would make the comment misleading in the one case where it matters most.

## The Fix

**`src/cli/bootstrap.ts`** — new pure signal:

```ts
export function actionsRunUrl(env: Readonly<Record<string, string | undefined>>): string | null
```

Built from `GITHUB_SERVER_URL` / `GITHUB_REPOSITORY` / `GITHUB_RUN_ID`; returns `null` if any is missing or empty. `PipelineContext` gains `runUrl: string | null`, populated with `actionsRunUrl(process.env)`.

Bootstrap is the right home: it is already the only place on this surface that reads `process.env`, and it already throws on a missing `GITHUB_TOKEN`. Taking the env as an argument rather than reading it inside keeps the function testable without mutating the real environment.

**`src/shared/audit-summary.ts`** — `AuditSummaryInput` gains `runUrl?: string | null`, and on a `FIX` decision the renderer appends: that a fix agent is starting, the blocking-finding count, `Watch it: <url>` when there is one, and the push-cancels warning.

**`src/cli/govern-command.ts`** — destructures `runUrl` from `createPipelineContext()` and passes it through.

### The purity constraint, which decided the shape

`src/shared/documentation/auditSummary.yml` declares `formatAuditSummary` `pure: true` with `receptors: []` and `effectors: []`. Reading `process.env` inside it would have falsified all three, and `audit-summary.ts` has no imports beyond types today. So the environment is read in the caller and the URL arrives as an argument. The neuron's new `excludes` records this so the next change does not undo it.

### Why not a second comment

Rejected, and recorded in `index.md`. PR comments are fed to the fix agent as human direction (`govern-command.ts:533`); bugfix `043` had just stopped the pipeline's own comments reaching there. A separate status comment would either re-enter the agent's prompt or need `043`'s marker to exempt it — at which point it is a comment the agent ignores and a person has to scroll past. The summary comment is already posted, already stamped, already filtered.

## Neurons

**Read:** `entrypoint.cli.bootstrap`, `shared.core.auditSummary`, `entrypoint.cli.governCommand`, `fix.fixer.fixer`, `verdict.decision.verdict`, `review.reviewer.findingReply`.

**Changing:**

| Neuron | Change |
|---|---|
| `entrypoint.cli.bootstrap` | new `actionsRunUrl` signal; `owns` gains the environment-read rationale; `createPipelineContext` gains an efferent to it |
| `shared.core.auditSummary` | gains `owns` (the announcement, the cancellation warning, why it is not a second comment) and `excludes` (no environment read); `formatAuditSummary` intent restated; provenance added |

`actionsRunUrl` is a new exported signal, so its `// @signal` anchor ships in the same commit (**KH-10**) and `pnpm neurons` enforces that it is documented. No signal is renamed or removed.

## Regression Test Plan

**`tests/cli/bootstrap.test.ts`** — three cases on `actionsRunUrl`: builds the URL; honours a GitHub Enterprise `GITHUB_SERVER_URL` rather than hard-coding `github.com`; returns `null` for an empty env, a partial env, and an empty-string variable.

**`tests/shared/audit-summary.test.ts`** — five cases on the FIX branch:

1. Says a fix agent is starting, alongside the unchanged `Decision:` line.
2. Contains the run URL.
3. Warns that a push cancels the attempt.
4. With `runUrl: null`, still announces — and contains no `actions/runs`, no `undefined`, no `null`.
5. `MERGE` and `BLOCK` say nothing about a fix agent.

Case 4 is the one that fails if the null path is handled by interpolating anyway. Case 5 is the one that fails if the announcement is appended unconditionally.

Sequencing: the plumbing (`actionsRunUrl`, the two optional fields, the pass-through) lands first and is verified inert at **730** tests — the count `043` left — so the eight new tests are the only thing that moves the number.

## Explicitly Out Of Scope

- **Telling ql-sprint the run URL.** `notifySprint('fix', …)` already reports the attempt to Telegram and could carry the link. That is a change to a different unit and a different message, and it belongs in its own task.
- **The other verdicts.** `MERGE` and `BLOCK` are not silent — each posts something a reader can act on immediately. Only `FIX` has a multi-minute gap.
- **MCP surface.** No tool, schema or return shape changes, so the `MCP Cases` sheet is present and empty.

## Version

`0.3.1 → 0.3.2` (PATCH). Adds a paragraph to a generated comment. `AuditSummaryInput.runUrl` is optional, so every existing caller still compiles and renders identically; `PipelineContext` gains a field, which widens a returned shape rather than narrowing one.
