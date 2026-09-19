# 025 — answer the findings

## The gap

The pipeline raises findings and never speaks in those threads again.

Observed on ql-desktop#40. `govern` posted three inline findings, the Cursor fixer ran in the same
job and pushed `4d46574` addressing all three — and the threads still read as three unanswered
complaints. Nothing on the PR connected the commit to the comments that caused it. A reader sees
"changes requested", three open threads, and has to diff the branch themselves to learn that the
pipeline already acted.

## What this adds

A reply in each finding thread, once the run knows what it did:

- **committed** — names the commit and the files, says the next review decides
- **no-changes** — the agent ran and produced nothing usable, so the finding stands
- **not-attempted** — a fork, a non-Cursor provider, or a BLOCK, with which one

## What it refuses to say

**That a particular finding was fixed.** `runFix` is given every finding at once and answers with
one commit; there is no mapping from finding to edit. Writing "resolved" in a specific thread would
be a guess dressed as a fact — the exact failure mode this repository keeps finding elsewhere.

So the reply says what was attempted and what landed, and leaves the verdict to the next review.
That is not a hedge: if the finding survives, the next run raises it again in the same thread, and
the thread then shows both the attempt and its failure. The evidence arrives either way.

Resolving threads and dismissing the review are deliberately **not** here. Marking a thread
resolved asserts the same thing the reply refuses to assert, and it should follow the *next*
review's evidence rather than this run's intent.

## Mechanics

`createReview` answers with the review, not its comments, so the ids are read back by listing the
PR's review comments and keeping those whose `pull_request_review_id` matches. That read is
wrapped: a failure there must not fail a review that already landed — the complaint is posted
either way, and losing the ids costs only the replies.

Replying is best-effort for the same reason. A reply that fails must not turn a fix that is
already pushed into a failed run; the worst case is an unanswered thread, which is where this
started.

For the committed case the replies go out **before** the run marks itself superseded, because the
push starts a fresh run and nothing later would know which threads these were.

## Next

Comment-driven re-runs — a comment on the PR re-triggers governance with your words as direction —
are the other half of this and are their own task. This one gives the threads a voice; that one
gives them ears.
