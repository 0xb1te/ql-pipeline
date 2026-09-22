# 045 — Summary

## What Shipped

`dedupeFindings` takes **one list per pass** instead of one flat list.

| Scope | Key | Effect |
|---|---|---|
| Across passes | `file:line` | a spot an earlier pass anchored is dropped, whatever rule it cites |
| Within one pass | `file:line:rule` | two rules on one line stay two findings |

The anchor set is filled only *between* passes. Filling it as each finding is kept would make a pass swallow its own second finding on a line — the failure the rule was in the key to prevent.

`govern-command.ts` keeps `reviewedByPass: Finding[][]` instead of flattening at `:599`.

## What Was Verified

| | |
|---|---|
| Full suite | **741 passed**, 55 files (was 738) |
| The two cross-pass cases red pre-fix | 2 failed, 16 passed |
| **No existing assertion weakened** | all 16 preserved cases passed *while* pre-fix semantics were reinstated |
| Restored source | byte-identical to the fixed source, confirmed by `diff` |
| Build / typecheck / lint / neurons | clean |
| Harness validator | 90 errors before and after, identical breakdown — all pre-existing on `main` |
| `dist/` | rebuilt and committed |

The middle two rows are the ones that matter. Rewriting a test suite to a new signature is exactly where a fix can quietly relax the assertions that would have caught it, so the pre-fix run was checked for what *passed* as well as what failed: all sixteen preserved cases held. `TASK045-2` and `TASK045-3` are the deliberate pair — the same two rules, one pass versus two, opposite expected results.

Gate 3 is open and cannot close here: a single-pass review cannot exercise this, and this repo's own PRs have been single-pass. It needs a PR whose standards slice into several passes.

## Why Wasn't This Caught

A test asserted the behaviour and defended it — `keeps two different rules broken on the same line`, commented *"A key of file:line alone would silently swallow the second."* That test is correct and it survives, now saying **by one pass**, which is what it always meant.

What it could not express is the other case: one defect, one line, six passes, six rules. The fixture had no notion of a pass because the function had no notion of a pass — and the caller had already flattened them away one file earlier.

The neuron had both halves of the argument written down and treated them as a trade-off to be settled rather than a distinction to be modelled. Including the rule protected one half and sacrificed the other; the pass boundary serves both.

**Prevention:** the boundary is in the signature now, so both cases are expressible and both are tested. A change that flattens the passes again fails `collapses one defect that every pass attributed to a different rule`.

## Version

`0.3.2 → 0.3.3` (PATCH)

`dedupeFindings` is not published API — `bin` exposes only `dist/main.js` and `dist/mcp/server.js`, and no consumer imports the module. The signature change is internal; the observable effect is a shorter findings list on a multi-pass review.
