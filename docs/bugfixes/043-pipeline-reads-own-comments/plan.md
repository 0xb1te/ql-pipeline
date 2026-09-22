# 043 — Plan

## Confirmed Root Cause

`src/shared/human-direction.ts:30` (pre-fix):

```ts
return comments.filter((comment) => !comment.isBot && comment.body.trim() !== '');
```

`isBot` is set in `src/shared/github-client.ts:488` as `user?.type === 'Bot'`. `runGovern` builds the direction block from it at `src/cli/govern-command.ts:533`:

```ts
direction = formatDirection(await client.listComments(pr).catch(() => []));
```

and hands the result to the fix agent as `humanDirection` (`src/cli/govern-command.ts:806`), where `buildFixerPrompt` substitutes it into `prompts/fixer.md`.

The condition is file/line exact: when the workflow runs as `secrets.GH_TOKEN` — a personal access token, which `.github/workflows/pr-pipeline.yml:110` prefers over `github.token` — every comment the pipeline posts is authored by a `User`, so `isBot` is `false` and the filter keeps it.

### Is the invariant wrong, or is the code failing it?

The code is failing it. `src/shared/documentation/humanDirection.yml` claims the guard in `owns`:

> Dropping bot comments, which is the loop guard and not tidiness — the pipeline comments on every run, and feeding those back would have it answering itself…

That is the correct intent and it is not enforced. The neuron is right; the filter is incomplete.

### Provenance read before declaring the cause

`docs/features/026-comments-as-direction/plan.md` — the only provenance link on the neuron. Its section *"Why bot comments are dropped"* states the loop-guard rationale, and records that the author's type comes from GitHub `rather than sniffing for a [bot]` name. So the type check was a deliberate choice, made before `GH_TOKEN` was in play.

`origin/features/030-guard-a-human-token` (commit `b4b5dd6`, *"keep the loop guard working once GH_TOKEN is a person"*) later found that this exact check fails for a human token. Its diff touches `.github/workflows/pr-pipeline.yml`, `src/shared/github-client.ts` and their tests — **not** `src/shared/human-direction.ts`. It introduced `AUTOMATION_MARKER` and applied it to the trigger guard only. This fix finishes 030 rather than contradicting it; the guard 030 added must not be removed.

## The Fix

Two edits, one behavioural.

1. **Move `AUTOMATION_MARKER` to `src/shared/types.ts`** (no behaviour change). It was declared in `github-client.ts`, which cannot be imported from `human-direction.ts`: `github-client.ts:3` already does `import type { PrComment } from './human-direction.js'`. That import is type-only and erases, so the client has no runtime dependency on the formatter — importing a *value* back would turn the erasure into a real cycle and pull `@actions/github` into a pure string function. `types.ts` has no imports and is the documented home for `pure shapes and enumerated constants`.

2. **Add the marker test to `humanComments`:**

```ts
return comments.filter(
  (comment) => !comment.isBot && !comment.body.includes(AUTOMATION_MARKER) && comment.body.trim() !== '',
);
```

`isBot` is kept, not replaced. It remains the only signal on repositories running the default `GITHUB_TOKEN`, and on comments posted before this change, which carry no marker.

### Why the marker and not the author

Declining every comment written by the account the pipeline posts as would drop the operator's own direction — the single mechanism for steering a fix attempt, and the thing `026` exists to provide. `github-client.ts` stamps every body it sends via `stampAutomated`, so the marker is present on exactly the pipeline's comments and nothing else.

## Neurons

**Read:** `shared.core.humanDirection`, `shared.core.githubClient`, `shared.core.types`, `shared.core.auditSummary`, `entrypoint.cli.governCommand`, `fix.fixer.fixer`, `review.reviewer.findingReply`.

**Changing:**

| Neuron | Change |
|---|---|
| `shared.core.humanDirection` | `owns` gains the two-voices guard and the what-not-who discriminator; `excludes` records that the author type is taken as given and that stamping belongs to the client; `humanComments` intent restated; provenance gains this task folder |
| `shared.core.types` | umbrella signal intent gains `AUTOMATION_MARKER` |
| `shared.core.githubClient` | `owns` records that the marker is now read from `types.ts`, not declared here |

No signal is added, renamed or removed, so no `// @neuron` / `// @signal` anchor moves (KH-10 is N/A). No new guard or constraint is introduced that is not already an `owns` bullet, so no new `invariant` entry is warranted.

`types.ts` imports carry no tract edge in this harness by established convention — `types.yml` declares `afferent: []` with a comment explaining that every unit imports it at compile time rather than through a traceable runtime signal, and `githubClient.yml` names no edge to it despite importing from it. This change follows that convention rather than introducing an asymmetry.

## Regression Test Plan

In `tests/shared/human-direction.test.ts`, a `pipelineSaid()` helper builds a comment the way `GH_TOKEN` actually produces one — `author: '0xb1te'`, `isBot: false`, body stamped with `AUTOMATION_MARKER`. The existing suite could not express this case at all; its loop-guard test only ever passed `isBot: true`.

Four cases, all of which must fail before the fix:

1. `humanComments` drops a stamped summary and a stamped thread reply, keeping one real comment.
2. `humanComments` keeps a person's comment written from the very same account.
3. `humanComments` drops a stamped inline comment (`path`/`line` present — the complaint review's findings arrive on the second endpoint).
4. `formatDirection` returns `''` for a pull request only the pipeline has spoken on.

Case 2 is the one that fails if the fix over-reaches and filters by author.

## Explicitly Out Of Scope

- **Auditing the other prompt inputs.** Only the direction block is fixed. Whether the review prompt has the same defect is a separate question and a separate task.
- **`should` findings.** Unrelated to this defect.
- **The MCP surface.** ql-pipeline's MCP server exposes the governance verbs (`040-governance-verbs-on-mcp`); this change alters no tool, no schema and no return shape, so it adds no MCP surface. The `MCP Cases` sheet in `testing-plan.xlsx` is therefore present and empty, per `workflow/flows/testing-plan.md`.

## Version

`0.3.0 → 0.3.1` (PATCH). Behaviour internal to one run; no consumer of the published API changes shape. Nobody was working around this — it is silent — so it is not the MAJOR that a worked-around behaviour change would be.
