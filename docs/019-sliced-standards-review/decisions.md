# Task 019 — decisions

Recorded per RULES.md R6.3: decisions that amend an approved plan belong here,
not silently in the diff.

## D1 — Passes are packed by budget, not one per document

**The plan said:** "one call per slice, each carrying the full diff, rules and
`checklist.md`, plus exactly one area slice."

**Implemented instead:** `planReviewPasses` fills each pass with as many
documents as the prompt budget will carry, and opens a new pass only when the
next document would not fit.

**Why.** Taken literally, one-pass-per-document is a cost regression for PRs
that have nothing wrong with them today. A PR touching `frontend` and `backend`
where both documents fit currently runs **one** review; under the literal rule
it would run **two**, buying nothing — the single prompt already carried both
whole. The goal of this task is that no section is ever dropped, not that every
document gets its own agent call.

Packing delivers the stated goal with a strictly weaker cost:

| Case | Today | Literal rule | Packed |
|---|---|---|---|
| one area that fits | 1 pass | 1 | **1** |
| two areas, both fit | 1 pass | 2 | **1** |
| one area, 3 slices | 1 pass (48% dropped) | 3 | **3** |

An area that fits pays nothing, and `discoverDocs` does not even probe for
slices when `${area}.md` is present.

**Cost of being wrong.** If packing is too aggressive the prompt ceiling
truncates — and task 017 means that is now reported rather than silent, in the
log and on the PR. The failure is visible, not quiet.

## D2 — Slices carry the area's id, not their own

Every slice of `frontend` is cited as `frontend.standards`, not
`frontend-2.standards`. Slicing is a transport detail; it should not change the
vocabulary a finding cites or the grounding check that validates it. A reviewer
handed one slice cannot tell it is holding a slice, which is the point.

`standardsIds()` deduplicates so a 3-slice area does not list its id 3 times.

## D3 — Discovery stops at the first gap

`frontend-1.md` present, `frontend-2.md` absent, `frontend-3.md` present is a
publishing mistake. The loop stops at the gap and reviews only slice 1.

Reviewing 1 and 3 while skipping 2 would hide the mistake behind a review that
looks complete. Stopping surfaces it as a short pack, which someone will notice.

## D4 — One failed pass fails the run

If any pass cannot be reviewed the PR escalates, rather than merging the
findings from the passes that did succeed.

Reviewing two thirds of the standards and reporting a verdict as though it were
whole is the exact failure this task exists to end. A partial review is not a
weaker review, it is an unreadable one.

## D5 — Verdict aggregation needed no new code

The plan called for worst-of aggregation (`BLOCK > FIX > MERGE`).
`decidePipelineOutcome` already takes the full finding list and derives the
verdict from severities, so merging the findings from every pass and calling it
once produces worst-of behaviour for free. Adding a separate aggregation step
would have been a second place for the verdict rules to live, and eventually to
disagree.
