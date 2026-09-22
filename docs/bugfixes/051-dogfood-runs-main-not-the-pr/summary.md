# 051 — Summary

## What Shipped

The `resolve` job of `pr-pipeline.yml` now decides which ql-pipeline every job runs, and exposes it as two outputs every **Checkout ql-pipeline** step reads:

| Caller | `ql-pipeline-repo` | `ql-pipeline-ref` |
|---|---|---|
| any consumer | `0xb1te/ql-pipeline` | the `ql-pipeline-ref` input, unchanged |
| `0xb1te/ql-pipeline` itself | the pull request's head repository | the pull request's head branch |

The input is read into the script through `env:` rather than interpolated. `dogfood.yml` changes only by a comment saying why it passes no ref. No source under `src/` changes and `dist/` is byte-identical.

## The Defect

`dogfood.yml` never set `ql-pipeline-ref`, whose default is `main`. Every job checked `0xb1te/ql-pipeline@main` out into `.ql-pipeline/` and ran `node .ql-pipeline/dist/main.js …` from there. The pull request's branch was only the *other* checkout — the repository under review — and the only thing a run took from it was the workflow YAML, because `uses: ./…` is local.

So the check that exists to prove a change to govern, gate or tester code never ran that change. Run `35728255439` on #43 (`0.6.0`) logged `task artifacts: complete …` and no `preview environment:` line — `0.5.1`'s output, against a branch whose `runGovern` always logs one. 049 recorded it as `TASK049-27`, `WARN`.

## Why `resolve`, Not `dogfood.yml`

`ql-pipeline-ref: ${{ github.head_ref }}` in the caller covers `pull_request` only. `github.head_ref` is empty on `issue_comment` and `pull_request_review_comment`, and those two events run the **default branch's** copy of `dogfood.yml` regardless — a comment-triggered re-run would have executed `main` all over again. `resolve` is where the pull request is known on every event, and a caller cannot forget an input the workflow does not read from it.

The head *branch* rather than the head *sha*, because the repository-under-review checkout uses the branch: the two checkouts are the same tree by construction, and a push between jobs already cancels the run.

## What Was Verified

| | |
|---|---|
| Full suite | **816 passed**, 58 files (was 810 / 57) |
| Regression test red against `main`'s workflows | **4 failed, 2 passed** |
| The two that held | the job list and dogfood's shape — invariants already true |
| Restored workflow files | byte-identical, confirmed by `cmp` |
| Typecheck / lint / neurons / build | clean |
| `dist/` after rebuild | 0 content changes, 0 new files |
| Harness validator | identical to a clean `main` worktree |
| Consumers | `ql-pipeline-ref` honoured exactly as before |

Gate 3, first half: this pull request's own dogfood run is a `pull_request` event and so runs the branch's YAML. Its `resolve` job announces `ql-pipeline governs itself: running 0xb1te/ql-pipeline@bugfixes/051-dogfood-runs-main-not-the-pr, not ql-pipeline-ref.` and every **Checkout ql-pipeline** step checks that ref out. Second half: the first governed pull request after the merge whose engine differs from `main` logs its own branch's lines. Recorded in the test plan as `TASK051-11` and `TASK051-12`.

Observed on run `35731658929`, the pull request's first dogfood run: `resolve` annotated `ql-pipeline governs itself: running 0xb1te/ql-pipeline@bugfixes/051-dogfood-runs-main-not-the-pr, not ql-pipeline-ref.`, and in every job both checkouts fetched `refs/heads/bugfixes/051-dogfood-runs-main-not-the-pr`, where every earlier run's second checkout fetched `main`. The govern job then routed to `infrastructure`, found the task folder complete, logged `preview environment: not required`, and escalated on R4 (`needs-human`, `checks / ql-pipeline` red) - the expected verdict for a pull request touching `.github/workflows/`. `TASK051-11` is `OK`; `TASK051-12` stays open until a pull request whose engine differs from `main` is governed.

## Why Wasn't This Caught

Because the run looked right. The workflow YAML *was* the branch's, the job names were the branch's, and the engine was green — `main`'s engine, which is always green on `main`'s own tests. Nothing in the log named the ref the engine came from; the `Checkout ql-pipeline` step printed `main` in a line nobody reads when the check is green.

It surfaced only when a branch added a log line and a person looked for it. 049's test plan was the first to list "the govern log on this pull request shows the new line" as a case, and the first to find it missing.

**Prevention:** the `resolve` job now prints a notice naming the repository and ref the engine runs from when ql-pipeline governs itself, so the ref is on the first screen of every run rather than inside a checkout step. The regression test pins the wiring so the checkouts cannot drift back to the input. And the rollup entry says not to move the decision into `dogfood.yml`.

One consequence worth naming: dogfood now runs the branch's **committed** `dist/`. A pull request that changes `src/` and forgets to rebuild ships a `dist/` that behaves like `main` — which is now visible on its own run, where before it was indistinguishable from a correct one.

## Version

`0.6.0 → 0.6.1` (PATCH). No source change; the workflow's contract for every consumer is unchanged. Only the repository that calls its own workflow behaves differently, and for it the old behaviour was the defect.
