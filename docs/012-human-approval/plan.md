# Task 012 — Human-approval merge mode

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Let a repository take the AI review without the AI merge: a MERGE verdict approves and labels, and a person makes the final call. |

## Why

Two reasons, one general and one concrete.

**General:** plenty of teams want an AI reviewer and no AI with write access to `main`. Until now the pipeline offered no way to have the first without the second — `executeMergeDecision` approved *and* merged, and the only way to stop it was to drop `ai-review` from `required_checks`, which throws away the review as well.

**Concrete:** [ql-sprint](../../../ql-sprint) drives this pipeline unattended across a whole sprint. When nobody is watching each PR individually, the human gate is the thing standing between a wrong review and a wrong `main`. ql-sprint requires this mode.

## The change

`merge.require_human_approval: true` (default `false`, so nothing changes for existing repos).

On a MERGE verdict the pipeline now:

1. Re-checks the head SHA — **unchanged, and still first**
2. Approves the PR with the advisory findings attached — **unchanged**
3. Applies the `ready-to-merge` label
4. **Stops.** The merge API is never called, and the branch is not deleted

The stop is placed deliberately *after* the staleness check and the approval, so the only difference between the two modes is whether `mergePullRequest` is called at all. The review — the valuable part — lands identically either way, because a human deciding whether to merge needs to see what the pipeline found.

Not deleting the branch matters: a branch whose PR nobody has merged still holds the work.

## The label is the interface

`ready-to-merge` is how an outside orchestrator finds PRs waiting on a person. It is a real contract now, not an internal detail — ql-sprint polls for it, sees an approved PR, and asks the user in Telegram. Renaming it would break that.

## Verification

`npm run typecheck && npm run lint && npm run build && npm test` green — **399 tests across 34 files** (394 before, plus 5 for this mode).

The five tests assert the properties that actually matter, rather than restating the implementation:

- **the merge API is never called** — if this ever passes while `mergePullRequest` fires, an unattended run could merge to `main` without a person
- the PR is still approved, with advisory findings attached
- the `ready-to-merge` label is applied
- **the branch is not deleted** — deleting the branch of an unmerged PR destroys the work
- **a stale PR is still refused before anything is approved** — the staleness check must run first in both modes, or a human would be asked to approve a revision that was never reviewed

The type change rippled into six test fixtures, each of which now pins `requireHumanApproval: false` — so the default staying "merge as before" is asserted by every existing test rather than assumed.
