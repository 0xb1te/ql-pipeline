# 043 — Summary

## What Shipped

`humanComments` now asks two questions instead of one. A pull-request comment is direction for the fix agent only if GitHub did not call its author a bot **and** its body does not carry `AUTOMATION_MARKER`.

Three files changed in `src/`:

| File | Change |
|---|---|
| `src/shared/types.ts` | `AUTOMATION_MARKER` moved here from `github-client.ts`, with the reason it cannot stay there |
| `src/shared/github-client.ts` | imports the marker instead of declaring it; `stampAutomated` and `openedByPipeline` unchanged |
| `src/shared/human-direction.ts` | the marker test added to the filter; `isBot` kept |

The move is not cosmetic. `github-client.ts` already imports `PrComment` from `human-direction.ts`. That import is type-only and erases, so the client has no runtime dependency on the formatter — had the formatter imported the marker back out of the client, the erasure would have become a real cycle, and a pure string function would pull in `@actions/github` to read one constant. `types.ts` has no imports at all.

## What Was Verified

| | |
|---|---|
| New tests red before the fix | 4 failed, 6 passed in `human-direction.test.ts` |
| Full suite after the fix | **730 passed**, 55 files (726 + 4) |
| Refactor proven inert on its own | 726 passed after the move, before the behaviour edit |
| Build / typecheck / lint | clean |
| Harness validator | 90 errors before and after, identical breakdown — KH-2 68, KH-3 16, KH-7 2, KH-1 2, KH-5 1. All pre-existing on `main` |
| `dist/` | rebuilt and committed, as this repo requires |

The test that matters most is `TASK043-2`: a person's comment written from the very same account the pipeline posts as still reaches the agent. Filtering by author would have passed every other case and quietly removed the only way anyone steers a fix attempt.

Gate 3 cannot close from here. The change only does anything on a repository whose workflow runs as `secrets.GH_TOKEN`, so confirming it in production needs a governed pull request on a configured repo — which means this one, after it merges.

## Why Wasn't This Caught

Feature `030-guard-a-human-token` found this exact defect and fixed one of the two places it lives. Its commit header is *"keep the loop guard working once GH_TOKEN is a person"*; it introduced `AUTOMATION_MARKER` and applied it to the workflow's re-trigger check and to `openedByPipeline`. `human-direction.ts` was not in its diff.

Two things hid the other half:

1. **The marker was declared where it was first used**, in `github-client.ts`, beside `stampAutomated`. A reader of `humanComments` had no reason to know it existed, and `humanComments` sits in a file with no import from the client.
2. **A test asserted the guard and did not exercise it.** `tests/shared/human-direction.test.ts` had a case named *"drops what the pipeline said, which is the loop guard"* that passed throughout — it constructed its pipeline comments with `isBot: true`, which is the one case that was never broken. The suite was green about the exact claim that was false.

The neuron said so too. `humanDirection.yml` has claimed the loop guard in `owns` since `026`, and the claim went on being true in the documentation while `GH_TOKEN` made it false in the code.

**Prevention:** the marker now lives in `types.ts`, owned by neither guard and imported by both, so the next person to read either half can see there are two. The regression tests build the pipeline's voice the way `GH_TOKEN` actually produces it — `isBot: false`, marker present — via a `pipelineSaid()` helper, so a filter that asks only about the author now fails.

## Version

`0.3.0 → 0.3.1` (PATCH)

Internal to a single governance run. No exported signature, MCP tool, schema or return shape changes, so nothing a consumer imports moves. It is not a MAJOR despite being a behaviour change: the old behaviour was silent, so there was nothing for anyone to have written a workaround against.
