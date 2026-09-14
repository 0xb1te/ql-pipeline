# Task 019 — Review oversized standards in slices

| | |
|---|---|
| **Status** | Awaiting approval |
| **Goal** | Stop dropping half the engineering standards on every frontend PR. Split the oversized pack documents and review the diff once per slice, so no section is ever cut. |

## The measurement

Task 017 made truncation report itself. A probe PR against recocicla
(a 38.9 KB diff, `pr-bugfix` pack, closed after reading) produced the first
real figures:

```
[per-area cap] dropped 53162 chars, 29 sections: 03 — Services, 04 — Routing &
  Lazy Loading, 05 — Guards, 06 — State Management, 07 — Hooks / Composables,
  08 — Directives, 09 — Pipes, 10 — Utilities, 11 — Styles, 12 — Assets (+19 more)
prompt: standards cut further to fit the prompt ceiling, dropped 8862 chars,
  4 sections: Changelog, 00 — Preflight, 01 — Components, 02 — Models
```

**31 of 64 sections — 48% — reached the reviewer.**

The two cuts are adjacent, and together they remove the document's entire
Stage-5 layer series: Components, Models, Services, Routing, Guards, State
Management, Hooks, Directives, Utilities, Styles, Assets, i18n, Forms,
**Auth/Security**, Analytics, **Error Handling**.

The reviewer keeps the design/UX half and loses the engineering half — which is
the half most PRs actually live in. Six recocicla PRs merged on `Findings: 0`
that could not have been anything else.

## It is not only `frontend.md`

Measured against the ~66,000 chars a single pass actually had available:

| Document | Size | × 3 packs |
|---|---|---|
| `frontend.md` | 132,112 | **over by ~2×** |
| `backend.md` | 103,370 | **over** |
| `mobile/ios/android.md` | ~60,05x | fits today; truncates once a diff passes ~45 KB |
| `infrastructure.md` | 12,537 | fine |
| `checklist.md` | 1,440 | fine |

`backend.md` has the same disease and nobody has measured it, because no
backend PR has been through the pipeline since 017 landed.

## Correction: a `frontend/` folder cannot work today

The obvious shape — `workflow/review/pr-bugfix/frontend/01-*.md` — is
**unreachable through house-api**, and this is already documented in
`src/standards/house-standards-reader.ts`:

> A doc that sits two or more levels below the route's entry node […] is
> genuinely unreachable through today's house-api: `expand()` unlocks a direct
> child of the *current* cursor but never moves the cursor and never returns
> the unlocked child's own `children`/`next` […] Reported as House problem
> `d5a75cba-3ede-4f35-afed-0f2dfdde9dcb`.

`frontend.md` is one level below the `review:pr-bugfix` entry. A file inside a
`frontend/` folder is two. So the split must stay **flat siblings**:

```
workflow/review/pr-bugfix/frontend-1-architecture.md
workflow/review/pr-bugfix/frontend-2-engineering.md
workflow/review/pr-bugfix/frontend-3-quality.md
```

Same depth as `frontend.md` and `checklist.md` today, so it resolves with no
reader change and no dependency on that House fix.

## Why three

Measured budget for standards in one pass, with a 38.9 KB diff: **65,893 chars**.

| Slices | Each | Headroom |
|---|---|---|
| 2 | ~64,000 | **+1,900** — inside the margin of error |
| **3** | ~42,600 | +23,300 |
| 4 | ~32,000 | +33,900 |

Two is a trap: the budget shrinks as the diff grows, and a 90 KB PR would leave
roughly 14,800 chars for standards. A 2-way split would start truncating again
on exactly the large PRs that most need reviewing. Three holds with room to
spare and keeps the per-PR review cost at 3×, not 4×.

## Design

### 1. Discovery — no directory listing exists

house-api has no "list children" call the reader can use, so discovery is by
probe, using the `exists()` the `StandardsReader` port already has:

- `${area}.md` present → **one entry, one pass. Unchanged behaviour.**
- otherwise probe `${area}-1-*.md`, `${area}-2-*.md`, … until one is absent

An area whose document still fits pays nothing: no extra probe round-trip
beyond the first `exists()`, which already happens today.

### 2. Multi-pass review

`runReview` is called once today (`govern-command.ts`). It becomes one call per
slice, each carrying the **full** diff, rules and `checklist.md`, plus exactly
one area slice. Every prompt stays well under `MAX_PROMPT_BYTES`, so
`buildReviewPrompt` should truncate nothing — and task 017's reporting is how
we will know that rather than assume it.

### 3. Merging

- **Findings**: concatenate, then dedup on `(file, line, rule)`. The same
  defect can legitimately surface in two slices; reporting it twice would be
  noise, and letting a dedup swallow a genuinely different finding at the same
  line would be worse — so the key includes the rule id.
- **Verdict**: worst-of, `BLOCK > FIX > MERGE`. A MERGE from one slice cannot
  overrule a BLOCK from another.
- **Failure**: if any slice fails to review, the PR escalates. Reviewing five
  sixths of the standards and calling it a pass is the failure mode this task
  exists to end.

### 4. Cost

Three agent calls per frontend PR instead of one, at
`cursor-grok-4.6-xhigh-fast`. A PR touching frontend *and* a sliced backend
would be five or six. This is the price of the standards actually being
applied; the alternative is the current state, where half of them are not.

Unsliced areas are unaffected.

## In scope

- ql-pipeline: discovery, multi-pass, findings merge, verdict aggregation, tests
- ql-docs: split `frontend.md` into three slices in **all three packs**
  (`pr-bugfix`, `pr-feature`, `pr-fix`) — they are near-identical copies
- `docs/SPECIFICATION.md` §Engineering standards, and `integration-guide.md`
- Rebuilt `dist/`

## Out of scope

- **`backend.md`.** Same disease, no measurement yet. Once this mechanism
  exists, splitting it is a ql-docs edit and no further pipeline work — but it
  should be measured on a real backend PR first, exactly as frontend was.
- Re-tuning `max_chars_per_area` or `MAX_PROMPT_BYTES`. With slicing, neither
  should bind.
- The house-api `expand` gap. This design routes around it.

## Exit criteria

1. A frontend PR reports **0 dropped sections** on every slice.
2. `Standards coverage` is absent from the summary, because nothing was cut.
3. A finding raised in any slice reaches the PR; a BLOCK in any slice blocks.
4. A duplicate finding across slices appears once.
5. An area with a single `${area}.md` still runs exactly one pass.
6. `typecheck && lint && build && test` green; `dist/` rebuilt.
7. Re-run the probe: 64 of 64 sections, and the numbers say so.
