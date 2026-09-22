# 045 — One Defect Reported Six Times, Under Six Rule Ids

## What

`dedupeFindings` keyed on `file:line:rule`. The review is sliced into passes because the standards do not fit one prompt, so each pass sees a different slice and cites whichever rule it was given — for the same defect it is looking at. Including the rule in the key meant those never matched, and every pass's copy survived.

It now takes **one list per pass** instead of one flat list. Across passes a spot is keyed on `file:line`, so a repeat is dropped whatever rule it cites. Within a single pass the rule still separates two findings.

## Why It Matters

Observed on ql-desktop [#103](https://github.com/0xb1te/ql-desktop/pull/103): one stray line of ql-docs template text in a testing plan was reported as **six findings under six rule ids** — `state-what-is-not-covered`, `state-gaps-honestly`, `accurate-completeness`, `no-implied-completeness`, `coverage-honesty`, and `docs.standards#SHOULD` — then four more on the next run. `Findings: 7` was one real problem and six restatements.

Three costs, in rising order:

1. **The review is unreadable.** Anything genuinely distinct is buried under restatements of the loudest nit.
2. **Six inline comments per defect.** Each finding opens its own thread on the same line.
3. **On a `FIX` verdict, every copy is handed to the fix agent.** The complaint the agent works from repeats itself six times, which is six times the prompt for one instruction.

## The Reasoning That Was Half-Right

The neuron already argued this out, in `reviewPasses.yml`:

> The same defect can legitimately surface in two passes… but two different rules broken on one line are two findings, and a key of `file:line` alone would silently swallow the second

Both halves are true. They cannot both be served by one flat key: including the rule protects the second and sacrifices the first. What was missing is that the passes themselves separate the two cases — and the caller was throwing that structure away, flattening every pass into one array at `govern-command.ts:599` before dedupe ever saw it.

## Why Wasn't This Caught

A test asserted the behaviour and protected it: `keeps two different rules broken on the same line`, with the comment *"A key of file:line alone would silently swallow the second."* That test is right, and it stays — it now says **by one pass**, which is what it always meant.

The case it could not express is the other one: the same defect, the same line, six passes. The fixture had no notion of a pass, because the function had no notion of a pass.

**Prevention:** the pass boundary is now in the signature, so both cases are expressible and both are tested. A future change that flattens the passes again fails `collapses one defect that every pass attributed to a different rule`.

## What Will Not Change

- A single-pass review — the common case, when the standards fit one prompt — dedupes exactly as before.
- Two rules on one line from one pass are still two findings.
- Severity, ordering and first-occurrence-wins are untouched.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/045-one-defect-six-times-3e3d29`, cut from `main` at `9059f85`
- **Task:** [One defect is reported six times under six rule ids](https://app.notion.com/p/One-defect-is-reported-six-times-under-six-rule-ids-3e3d2993e9a98113b681e344f3286f0a) on `QL Desktop-sprint-2`
- **Gate note:** Gate 3 needs a multi-pass review on a real PR to observe. A single-pass review cannot exercise it, and this repo's own PRs have been single-pass.
