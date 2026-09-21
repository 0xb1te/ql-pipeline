# 042 — Technical Plan

## Problem

`taskArtifactFindings` was called after the R4 protected-paths guard, which returns:

```ts
if (touchesProtectedPaths(changedFiles, config.fixer.protectedPaths)) {
  await escalateToHuman(/* ... */);
  return;                              // <- everything below is unreachable
}

const artifactFindings = taskArtifactFindings(/* ... */);
```

On a governance pull request the function was never entered. No finding, no log line, nothing in the comment.

## Debug Trail

PR #34's `checks / ql-pipeline` job, run `35652737024`, job `106509319409`, is thirty seconds long and its entire error output is:

```
[error] PR touches protected pipeline-governance paths and requires human review
##[error]Process completed with exit code 1.
```

No `task artifacts:` line appears, which `taskArtifactFindings` logs unconditionally on every path — including the "not checked" one. Its absence is the proof the call was never reached, rather than reached and quiet.

Confirmed by reading `runGovern` in the merged tree: the `return` sits eleven lines above the call.

## Root Cause

Placement, not logic. The check was put beside `readGateReports` because that is where the other finding-producers live, and the early return above it reads as unrelated. `escalateToHuman` was never designed to carry anything but its own sentence, so there was no obvious seam to hang a second finding on — which is what made "after" look like the only option.

## Scope

### In scope

| Unit | Change |
|---|---|
| `src/cli/govern-command.ts` | `taskArtifactFindings` moved above the R4 guard; new pure `protectedPathsComment` composes the escalation body |
| `src/cli/documentation/governCommand.yml` | The new signal and its edges; the ordering claim in `taskArtifactFindings`' intent corrected |
| `tests/cli/govern-command.test.ts` | Coverage for `taskArtifactFindings` against a real temp tree, and for the comment composition |

### Explicitly out of scope

- **R4 itself.** It still escalates, still labels, still refuses to auto-merge or auto-fix. Only what travels alongside its message changes.
- **Severity.** Still `should` unless a repository opts in. This makes the check *run* on more pull requests, not block more of them.
- **Moving other checks ahead of R4.** `taskProvenanceFindings` reaches ql-sprint over the network, and making a governance escalation wait on an external service would trade a clear failure for a flaky one. Only the filesystem check moves.
- **Re-running the check on #34.** That pull request is merged; the fix applies from here.

## Decisions

### A pure `protectedPathsComment`, not a longer `escalateToHuman`

Moving the call up alone would have changed nothing observable — the escalation would still have returned and still have said only its own sentence. The finding has to travel *in* that comment.

Composing it in a separate pure function, rather than threading findings through `escalateToHuman`, keeps `escalateToHuman` the single-purpose thing it is (label, comment, fail) and makes the composition testable without a GitHub client. That is the same split `complaintReview` already uses, for the same reason.

### Only the filesystem check moves

`taskProvenanceFindings` stays where it is. It asks ql-sprint over the network and fails open by design; running it ahead of a governance escalation would make an R4 comment's contents depend on whether an external service answered. A structural check on the local checkout has no such failure mode.

## Contract Impact

None. No type, config value, or public signature changes. `protectedPathsComment` is newly exported for testing, which is additive.

No version bump: nothing in the published contract moves, and the behaviour change is a defect repair rather than a feature. `package.json` stays at `0.3.0`.

## Verification

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` — green.
- `pnpm test` — the full suite, with 8 new tests in `tests/cli/govern-command.test.ts`.
- The new tests cover the case that was missing: an R4 escalation whose task folder is incomplete now carries the finding, asserted on the composed body rather than on a mock.
- `validate-harness.py` diffed against a clean `main` worktree: identical output.

## Definition Of Done

A governance pull request with a missing `seed.sql` says so in the same comment that summons the human, and a future change that drops that finding fails a test instead of shipping.
