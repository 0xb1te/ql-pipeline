# 047 — Summary

## What Shipped

A `should` finding now dispatches a fix agent instead of sitting in a thread that belongs to nobody.

When nothing blocks but advisory findings stand, `decidePipelineOutcome` returns `FIX` over them. Returning `FIX` is what kept this small: the complaint review, the threads, the pickup announcement, attempt counting, the fork and provider guards and the retrigger are all the existing path, untouched.

New config key `fixer.fix_advisory`, default on, refused rather than coerced if it is not a boolean.

## An Advisory Finding Still Never Blocks

Every guard falls back to **MERGE**, never BLOCK — attempts spent, not auto-fixable, feature off, or a gate finding mixed in. It was a comment before this and goes back to being one the moment there is nothing left to try. What changed is that somebody is assigned to it, not whether it stands in the way. That is recorded as an invariant on the neuron, replacing the one this makes false.

## The Distinction That Took The Longest

Two different things produce a `should` finding:

- The **review** judged a finding minor.
- **`required_checks`** makes a failed gate `should` because an operator left it out of the required list — an instruction, not a judgement.

`gateFindings` builds both with `autoFixable: true`, so they are indistinguishable by severity. The first implementation dispatched on both, and an existing test went red whose name states the intent outright: *"a failed non-required gate rides along as advisory and still merges."*

**That test found the bug in my fix**, and it now passes unchanged — which is the evidence the exclusion is right rather than convenient. Gate findings are excluded by their `gate#` rule prefix, and a mixed set declines **entirely** rather than dispatching the reviewable half, because `FIX` empties `advisoryFindings` and the merge path is the only thing that posts it.

## What Was Verified

| | |
|---|---|
| Full suite | **775 passed**, 56 files (was 762) |
| Build / typecheck / lint / neurons | clean |
| Harness validator | identical to baseline |
| Pre-existing verdict assertions | all keep their meaning — the advisory-only case already used `autoFixable: false`, so the new guard declines it unchanged |
| `dist/` | rebuilt and committed |

The integration and chaos tests pass `fixAdvisory` from their own `CONFIG` rather than a literal, so they exercise the real default rather than a value chosen to make them pass.

Gate 3 is open: it needs a governed PR whose review raises only advisory findings. ql-desktop #103 is exactly that, and reopening it once this merges is the intended check.

### Gate 3, revisited 2026-09-22 — still open, and the plan above was wrong

ql-desktop #103 merged rather than being reopened, and its findings could not have closed the gate anyway.

Four governed pull requests since this merged — ql-desktop [#105](https://github.com/0xb1te/ql-desktop/pull/105), [#106](https://github.com/0xb1te/ql-desktop/pull/106), [#107](https://github.com/0xb1te/ql-desktop/pull/107) and [#109](https://github.com/0xb1te/ql-desktop/pull/109) — each posted *"### Advisory findings … None of them blocked the merge"* and merged. Every finding was `task#provenance`, which is built `autoFixable: false` (`src/verdict/task-provenance.ts:160`), so the new guard **declined** and fell back to MERGE.

That is the right answer, and it is worth having: the decline branch is now confirmed **live**, four times, on real pull requests. It is not this gate. The dispatch branch needs an advisory finding the *review* judged minor — not a task-provenance notice, and not a gate finding, both of which this deliberately excludes.

**So Gate 3 cannot be scheduled, only waited for**, since it needs a review to volunteer an auto-fixable `should`. And as of 2026-09-22 GitHub Actions is refusing to start jobs on this account for billing, so no governance run of any kind is observable until that clears.


## Known Hazard, Filed Separately

`countFixAttempts` counts commits whose header ends `[bot]` — which `runFix` writes and **ql-agents does not**, because under that provider ql-agents commits with its own message. So the counter reads 0 forever and `max_fix_attempts` never trips.

That was survivable while only blocking findings dispatched, since those are rarer. It is more exposed now that advisory ones do too. It does not affect ql-desktop, which uses the default `cursor` provider, and the fix is a change to how attempts are counted — its own task, with its own tests.

## Version

`0.4.0 → 0.5.0` (MINOR)

A new config key and a changed default behaviour, additive in shape: every existing config parses unchanged. Default-on is the reason the key exists at all — a repository that would rather read its own nits sets `fix_advisory: false` and gets the previous behaviour exactly.
