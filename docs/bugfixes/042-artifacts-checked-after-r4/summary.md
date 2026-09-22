# 042 — Shipped

- **Date:** `2026-09-21`
- **Branch:** `bugfixes/042-artifacts-checked-after-r4` merged into `main` as `4cd260a`
- **Deployed to:** consumer repositories on their next governance run.

## What Shipped

- `taskArtifactFindings` now runs **before** the R4 protected-paths guard instead of after it. That guard `return`s, so on any pull request touching `rules/`, `prompts/`, `pipeline.config.yml` or `.github/workflows/`, the check was never entered at all.
- The R4 escalation comment now **carries** whatever the check found, composed by a new pure `protectedPathsComment`.

**What a future change must not undo:** moving the call up alone fixes nothing. R4 returns before the review, the gates and the verdict, so anything not in that one comment is reported nowhere. The finding has to travel *in* it. `protectedPathsComment` is pure and tested directly for exactly this reason — a change that drops a structural finding from that comment now fails a test rather than going unnoticed.

`taskProvenanceFindings` deliberately stayed where it is: it reaches ql-sprint over the network and fails open, and making a governance escalation's contents depend on an external service answering would trade a clear failure for a flaky one.

## What Was Verified

| Source | OK | KO | WARN |
|---|---|---|---|
| `testing-plan.xlsx` | `9` | `0` | `0` |

- **Open `KO` / `WARN` rows:** none.
- **Automated:** typecheck, lint and build green; 726 tests passing (8 added here); harness validator byte-identical to `main`.
- **Verified in production by:** this PR's own governance run, which is the proof the fix works. The job ran 2m17s instead of the 30s R4 escalation on `041`, and the log carries the line whose *absence* on `041` was the evidence of the bug:

  ```
  [info] task artifacts: complete in docs/bugfixes/042-artifacts-checked-after-r4
  ```

  Verdict **MERGE**, labelled `ready-to-merge`, with one advisory `task#provenance` finding — correct, since this branch was cut by hand and carries no ql-sprint task id.

## Commits

- `e3e652d` — `fix(infrastructure): check the task folder before R4 returns, not after it`

## Post-Deploy Actions

- None defined by this project.

## Follow-Ups

- **No version bump**, deliberately: nothing in the published contract moved and this is a defect repair. `package.json` stays at `0.3.0`.
- **R4's authority is unchanged** — it still escalates, labels `needs-human`, and refuses to auto-merge or auto-fix. Only what travels alongside its message changed. Severity is unchanged too, so this makes the check *run* on more pull requests, not block more of them.
- **The class of bug is worth remembering.** Order-of-operations defects survive unit tests by construction: every part worked, and `taskArtifactFindings` had its own passing tests the whole time. What caught it was reading a CI log and noticing a line that should have been there and was not.
