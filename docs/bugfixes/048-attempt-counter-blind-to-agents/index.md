# 048 — The Attempt Counter Was Blind To A Provider That Commits For Itself

## What

`countFixAttempts` read the attempt count off the commit history — commits whose header ends `[bot]`, which `runFix` writes itself:

```ts
const BOT_COMMIT_HEADER = /\[bot\]\s*$/;
```

That is only pipeline evidence while the pipeline is what commits. Under the `ql_agents` provider it is not: ql-agents clones onto its own host and commits with its own message. So the counter saw **nothing**, every run read attempt 1, `max_fix_attempts` never tripped, and each push started another attempt.

An unbounded fix loop, limited only by Actions minutes.

The counter now also counts `FIX_ATTEMPT_MARKER` — an HTML comment the pipeline stamps on the summary when it decides to attempt a fix — and takes the **larger** of the two sources.

## Why It Matters

Introduced by feature `046`, which added the `ql_agents` provider, and widened by `047`, which let advisory findings dispatch too. A review that raises a fresh cosmetic nit on each pass now had a path to loop on cosmetics forever.

It was never reachable on ql-desktop, which uses the default `cursor` provider and sets no `QL_AGENTS_URL` — but it was live in `main` for any repository that switched.

## Why The Maximum, Not The Sum

Neither source is redundant, and they overlap:

| | `[bot]` commits | markers |
|---|---|---|
| cursor, one attempt | 1 | 1 |
| PR older than the marker | N | 0 |
| ql_agents | 0 | N |

Summing would report **two** attempts for one on the cursor provider, exhausting `max_fix_attempts` at half its configured budget. The maximum is correct in all three rows.

## Where The Marker Lives

On the audit summary, which `044` already made announce a starting fix. That comment is posted exactly once per run and only says a fix is starting on a `FIX` decision — **one marker per attempt, by construction**, with no new comment and no new API call. It renders as nothing.

## The One Failure That Matters

Reading zero when a marker exists but cannot be read restores the loop this removes. The caller reads comments best-effort — the same endpoint its direction block already uses — and passes an empty list on failure, which falls back to commit evidence. Correct for cursor; under `ql_agents` it starts a fresh count rather than refusing a fix nobody has attempted.

That is a deliberate trade, recorded in `owns`: a pipeline that refuses to fix because GitHub was briefly unreachable is worse than one that occasionally grants an extra attempt.

## What Will Not Change

- The cursor provider counts exactly as before — the maximum of `(N, N)` is `N`.
- Pull requests opened before this change have commits and no markers, and still count correctly.
- `max_fix_attempts`, the verdict and the fix loop are untouched. Only the count they read changes.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/048-attempt-counter-blind-to-agents`, cut from `main` at `c264815`
- **Task:** [The attempt counter is blind to ql-agents commits](https://app.notion.com/p/The-attempt-counter-is-blind-to-ql-agents-commits-3e3d2993e9a9819cbe12f683f3b02984) on `QL Desktop-sprint-2`
- **Gate note:** Gate 3 needs a repository configured for `ql_agents` to reach a second fix attempt. None exists, which is also why the defect was never observed rather than reasoned about.
