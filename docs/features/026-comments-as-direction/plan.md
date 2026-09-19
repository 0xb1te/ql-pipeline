# 026 — comments as direction

## The gap

The pipeline reviews a PR against rules and standards, and is deaf to the person standing next to
it. If you disagree with a finding, or know the fix should take a particular shape, there is
nowhere to say so: the next run reads the same rules and reaches the same conclusion.

## What this adds

Every govern run reads the PR's comments — the conversation and the inline review threads — drops
everything the pipeline itself wrote, and hands the rest to **both** agents:

- the **reviewer** sees it, so a finding can be raised or dropped in light of what you said
- the **fixer** sees it, because the agent that writes code is the one an instruction like
  "use the existing helper" has to reach

Both prompts say the same thing about weight: direction decides *how* a `[must]` finding is fixed,
never whether it is.

## Why bot comments are dropped

Not tidiness — it is the loop guard. The pipeline posts a summary and a review on every run, and
now answers each finding thread too (025). Feeding those back as "direction" would have it reading
its own complaints as instructions. Once a comment can *trigger* a run, it would also re-trigger on
its own writing and never stop.

The author's type comes from GitHub (`user.type === 'Bot'`) rather than sniffing for a `[bot]`
suffix a person could put in their display name.

## Ordering and truncation

Oldest first, because a conversation reads forwards and a later instruction is meant to override an
earlier one — the agent has to see which way time runs. When there is more than fits, the *oldest*
are dropped: the most recent word is the one a person expects to be followed.

## What is not here

**A comment does not yet re-trigger the run.** The reusable workflow is `workflow_call` only, so the
trigger belongs to the caller — and `issue_comment` carries no head ref, so all three jobs would
have to resolve the PR before checking it out. That is workflow surgery, separate from this, and it
is the next task.

Until then this still applies on every run the PR already has: comment, then push or re-run, and
the agent carries what you said.
