# 042 — The Task-Folder Check Never Ran On A Governance PR

## What

The structural check that verifies a task folder carries `testing-plan.xlsx` and `seed.sql` was wired in **after** the R4 protected-paths escalation. R4 returns early, so on any pull request touching `rules/`, `prompts/`, `pipeline.config.yml` or `.github/workflows/`, the check never executed at all.

Two changes:

1. The check now runs **before** the R4 escalation.
2. When R4 escalates, its comment carries whatever the check found.

## Why It Matters

R4 escalation returns before the review, before the gates are weighed, and before a verdict is reached. Anything not said in that one comment is said nowhere. So the pull requests that skipped this check were precisely the ones with the most human attention on them — a person summoned to review a change to the pipeline's own laws, who would have had to discover separately that the task folder was also incomplete.

The two questions are orthogonal. "Does this PR touch governance paths?" and "does its task folder carry a test plan?" have nothing to do with each other, and ordering them so that the first answer suppresses the second was arbitrary.

## How It Was Found

PR #34 — the one that introduced the check — hit R4 on itself, because it edits `prompts/reviewer.md`, `.github/workflows/pr-pipeline.yml` and `documentation/brain.yml`. The governance job failed with the R4 message and nothing else. Reading the run, the check it had just shipped was never reached.

The check was verified locally against three branches before that, which is why it was known to work at all. What was not noticed is that CI would never exercise it on that particular pull request.

## Why Wasn't This Caught

The check was placed next to the gate reports because that is where the other finding-producers live, and nothing about that position looked wrong. The early `return` above it is eleven lines away and easy to read past.

No test covered it: `taskArtifactFindings` was unit-tested in isolation, and `runGovern`'s ordering was not covered by anything. Order-of-operations bugs survive unit tests by construction — every part works.

**Prevention:** the escalation's comment is now built by a pure function, `protectedPathsComment`, which is tested directly. A future change that drops a structural finding from that comment fails a test rather than going unnoticed for a release.

## What Will Not Change

- R4 still escalates, still labels `needs-human`, still refuses to auto-merge or auto-fix. Nothing about its authority moves; only what the comment says alongside it.
- The check's severity is unchanged — `should` unless a repository lists `task-artifacts` in `merge.required_checks`. This makes it *run* more often, not block more often.
- A branch naming no task folder still raises nothing.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `pending` | `—` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/042-artifacts-checked-after-r4`, cut from `main` at `ef509a6`
- **Gate note:** delivered from a direct instruction to move the check ahead of the escalation. No Gate-1 or Gate-2 presentation-and-YES cycle was run, so neither is recorded as closed. `summary.md` is deliberately absent until a human says to ship.
