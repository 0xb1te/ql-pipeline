# 051 — Dogfood Ran `main`'s Code Against The Pull Request's YAML

## What

`dogfood.yml` calls the reusable workflow with `config-path` and nothing else. The reusable workflow's `ql-pipeline-ref` input defaults to `main`, and every job's **Checkout ql-pipeline** step read it:

```yaml
- name: Checkout ql-pipeline
  uses: actions/checkout@v4
  with:
    repository: 0xb1te/ql-pipeline
    ref: ${{ inputs.ql-pipeline-ref }}     # main, on every dogfood run
    path: .ql-pipeline
```

So each job ran `node .ql-pipeline/dist/main.js …` from **`main`**, while the pull request's branch was only the *other* checkout — the repository under review. The only thing a dogfood run took from the branch was the workflow YAML itself, because `uses: ./.github/workflows/pr-pipeline.yml` is a local reference.

A change to govern, gate or tester code was therefore never once exercised by the check meant to prove it. The check was green because `main` was green.

## The Proof

Run `35728255439` on #43 (`features/049-preview-environment-gate`, version `0.6.0`). That branch's `runGovern` logs one of three `preview environment:` lines immediately after `task artifacts:`. The run logged:

```
[info] task artifacts: complete in docs/features/049-preview-environment-gate
```

and no `preview environment:` line at all — the output of `0.5.1`, which was `main`. 049's own test plan recorded it as `TASK049-27`, `WARN`, and moved its Gate 3 to "the first governed run after the merge".

## Where The Fix Lives

The `resolve` job of `pr-pipeline.yml` already answers "which pull request is this?" once, for every event, and hands the answer to every other job. It now answers "which ql-pipeline runs?" in the same place:

| Caller | `ql-pipeline-repo` | `ql-pipeline-ref` |
|---|---|---|
| any consumer | `0xb1te/ql-pipeline` | the `ql-pipeline-ref` input, as before |
| `0xb1te/ql-pipeline` itself | the pull request's head repository | the pull request's head branch |

All four **Checkout ql-pipeline** steps read those two outputs and nothing else. When ql-pipeline governs itself, the engine checkout and the repository-under-review checkout are the same repository at the same ref, by construction.

## Why Not `ql-pipeline-ref: ${{ github.head_ref }}` In `dogfood.yml`

That was the obvious fix, and it covers one of the three events. `github.head_ref` is empty on `issue_comment` and `pull_request_review_comment` — and those two run the **default branch's** copy of `dogfood.yml` regardless, so a comment-triggered re-run would still have executed `main`. The `resolve` job is the one place where the pull request is known on every event, and a caller cannot forget an input it does not have to set.

## What Will Not Change

- **Consumers.** A consumer's `ql-pipeline-ref` is honoured exactly as before; the input's default is still `main`. Only a caller whose `github.repository` is `0xb1te/ql-pipeline` is treated differently.
- **`dist/`.** No source under `src/` changes. The engine dogfood runs is the branch's *committed* `dist/`, which is the point — and which means a pull request that forgets to rebuild `dist/` is now visible as one that behaves like `main`.
- **Fork pull requests.** The gate jobs already run a fork's own `package.json` scripts; running its `dist/main.js` adds no exposure a fork did not already have.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/051-dogfood-runs-main-not-the-pr`, cut from `main` at `4a76fc2`
- **Task:** [Dogfood governs a ql-pipeline PR with main's engine, not its own](https://app.notion.com/p/Dogfood-governs-a-ql-pipeline-PR-with-main-s-engine-not-its-own-3e3d2993e9a981d58e8ae45349cf8d95) on `QL Desktop-sprint-2`, filed after the pull request opened
- **Gate note:** delivered from a written brief that pre-scoped the work and named the fix. Gate 1 is recorded as closed on that brief; Gate 2 is the pull request. Gate 3 has two halves. First, this pull request's own dogfood run — a `pull_request` event takes the workflow YAML from the branch, so the `resolve` job should already announce `ql-pipeline governs itself: running 0xb1te/ql-pipeline@bugfixes/051-dogfood-runs-main-not-the-pr`, and every **Checkout ql-pipeline** step should check that ref out. Second, the first governed pull request after the merge whose govern differs from `main` should log its own branch's lines. `.github/workflows/` is an R4 protected path in `pipeline.config.yml`, so the pull request goes to a person.
