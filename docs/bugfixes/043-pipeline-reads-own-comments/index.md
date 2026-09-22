# 043 — The Pipeline Read Its Own Comments As Human Direction

## What

`humanComments` decides which pull-request comments reach the fix agent as instructions. It asked one question — *did a bot write this?* — and GitHub answers that with `user.type === 'Bot'`.

On every repository configured with `secrets.GH_TOKEN`, that answer is `false` for the pipeline's own comments, because the workflow posts as the operator's account. So the summary, the complaint body and every reply written into a finding thread came back on the next run as *what people said on the pull request*, and were handed to `cursor-agent` as direction.

The fix adds the second test the guard always needed: a body carrying `AUTOMATION_MARKER` is dropped, whoever GitHub says wrote it.

## Why It Matters

The fix agent is given two things: the findings to repair, and what people asked for. Only the second is free text, and it is weighted as intent — `prompts/fixer.md` exists to make the agent follow it. Filling it with the pipeline's own verdict means the agent re-reads a complaint as though a person had just made it, on every attempt after the first.

It is also the failure mode the unit's own documentation says it prevents. `humanDirection.yml` claims the loop guard in `owns`, and `026-comments-as-direction/plan.md` spends a section on why bot comments are dropped. Both were true when written. Neither survived `GH_TOKEN`.

## How It Was Found

Not from a failure — nothing fails. It came out of a question about who repairs a review finding, while reading `govern-command.ts` to answer it. The `isBot` filter and the comment on `AUTOMATION_MARKER` are ninety lines apart in two files, and the second explains precisely why the first cannot work.

## Why Wasn't This Caught

Feature `030-guard-a-human-token` found this exact defect. Its commit header is *"keep the loop guard working once GH_TOKEN is a person"*, and it introduced `AUTOMATION_MARKER` to fix it.

It fixed one of the two places the guard lives. `030` changed `pr-pipeline.yml` and `github-client.ts` — the workflow's re-trigger check, and `openedByPipeline` on review threads. `human-direction.ts` was not in its diff, and nothing connected the two: the marker was declared in the client, beside the function that stamps it, so a reader of `humanComments` had no reason to know it existed.

The test suite agreed. `tests/shared/human-direction.test.ts` had a case named *"drops what the pipeline said, which is the loop guard"* that passed — it only ever constructed comments with `isBot: true`, which is the one case that was never broken.

**Prevention:** `AUTOMATION_MARKER` now lives in `shared/types.ts`, imported by both guards rather than owned by one of them. The regression tests construct the pipeline's voice the way `GH_TOKEN` actually produces it — `isBot: false`, marker present — so a future filter that asks only about the author fails rather than passes.

## What Will Not Change

- A person's direction still reaches the agent unchanged, including from the same account the pipeline posts as. The discriminator is what a comment says, not who wrote it — declining everything `0xb1te` wrote was the alternative, and it would have thrown away the only way anyone steers a fix attempt.
- `isBot` stays. It is still the only signal on a repository running the default `GITHUB_TOKEN`, where comments arrive as `github-actions[bot]` and carry no marker from before this change.
- Nothing about the verdict, the findings, or what gets committed moves.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/043-pipeline-reads-own-comments-3e3d29`, cut from `main` at `3c1b021`
- **Task:** [The pipeline reads its own comments as human direction](https://app.notion.com/p/The-pipeline-reads-its-own-comments-as-human-direction-3e3d2993e9a98173a8eddacea54de4f5) on `QL Desktop-sprint-2`
- **Gate note:** Gate 1 was presented in full and closed with an explicit YES before any source file was edited. Gate 3 needs a governed pull request to run against a `GH_TOKEN` repository, so it cannot close before this merges.
