# 044 — Summary

## What Shipped

On a `FIX` verdict, the summary comment now says a fix agent is starting, how many blocking findings it has, where to watch the run, and that pushing cancels the attempt.

| File | Change |
|---|---|
| `src/cli/bootstrap.ts` | new pure `actionsRunUrl(env)`; `PipelineContext` gains `runUrl: string \| null` |
| `src/shared/audit-summary.ts` | `AuditSummaryInput` gains `runUrl?`; the FIX branch renders the announcement |
| `src/cli/govern-command.ts` | destructures `runUrl` and passes it through |

The environment is read in `bootstrap.ts` and the URL arrives as an argument, because `auditSummary.yml` declares `formatAuditSummary` `pure: true` with empty receptors and effectors. Reading `process.env` inside the renderer would have falsified all three. The neuron's new `excludes` records that, so the next change does not quietly undo it.

Not a second comment, deliberately. PR comments are fed to the fix agent as human direction (`govern-command.ts:533`), which bugfix `043` had just finished closing off — a separate status comment would either re-enter the agent's prompt or need `043`'s marker to exempt it, at which point nobody reads it. The comment that is already posted, already stamped and already filtered is the right place.

## What Was Verified

| | |
|---|---|
| Plumbing proven inert first | **730 passed** — the count `043` left — with the fields wired but nothing rendered |
| New tests red before the rendering | 4 of the audit-summary cases failed; the 3 `actionsRunUrl` cases passed on the inert commit, as intended |
| Full suite after the fix | **738 passed**, 55 files (730 + 8) |
| Build / typecheck / lint | clean |
| `pnpm neurons` | OK — the new `@signal actionsRunUrl` is documented |
| Harness validator | 90 errors before and after, identical breakdown — all pre-existing on `main` |
| `dist/` | rebuilt and committed |

Two tests carry the design rather than the feature. `TASK044-7` fails if the null path interpolates anyway and posts a link built from absent values; `TASK044-8` fails if the announcement is appended to `MERGE` and `BLOCK` as well.

Gate 3 needs a real `FIX` verdict to observe, and no run has produced one since this merged. It stays open rather than being closed on a green suite.

## Why Wasn't This Caught

Nothing was broken, so nothing failed. `formatAuditSummary` rendered every field it was handed and its tests asserted each one; the defect was a field nobody passed. No part of `src/` read `GITHUB_RUN_ID` or `GITHUB_SERVER_URL`, so the run the pipeline executes in was not something the code knew existed.

A unit test cannot catch that by construction — there is no way to assert the absence of a value that was never conceived of. What made it visible was reading `runGovern` top to bottom and noticing the 170-line gap between the comment at `:630` and `runFix` at `:800`: the signal was already there, and already unreadable.

**Prevention:** the run is now a value the surface holds, not an ambient fact — `actionsRunUrl` is a pure function with its own tests including the null path, and `runUrl` is a field on `PipelineContext` that any future comment or notification can use without rediscovering the three variables.

## Version

`0.3.1 → 0.3.2` (PATCH)

Adds a paragraph to a generated comment. `AuditSummaryInput.runUrl` is optional, so every existing caller compiles and renders identically; `PipelineContext` gains a field, widening a returned shape rather than narrowing one. Nothing a consumer imports changes signature.
