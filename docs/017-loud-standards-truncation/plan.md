# Task 017 — Report what standards truncation drops

| | |
|---|---|
| **Status** | Approved 2026-09-14; implemented |
| **Goal** | Make both standards-truncation layers name what they removed, so a review's coverage is readable instead of assumed. |

## Why

A consumer repo (recocicla) merged six PRs, every one returning `Findings: 0`.
The frontend reviews were run against a standards document that had been cut,
and nothing in the log, the PR summary, or the prompt said which sections went
missing. `Findings: 0` was therefore not readable: it could mean "nothing to
report" or "the rule that would have caught it was not in the prompt".

Two layers cut, and they do not report the same way:

| Layer | Site | Budget | Today |
|---|---|---|---|
| Per-area | `standards-resolver.ts:113` | `standards.max_chars_per_area` | logged as a bare `[truncated]` flag |
| Whole prompt | `reviewer.ts:59-88` | `MAX_PROMPT_BYTES` (120,000) | **silent** — no log line at all |

The second layer is the more misleading one. It shares its budget with the
diff, so the same standards document is cut by a different amount on every PR,
and a large diff can quietly evict most of the standards.

## Neurons read

- `standards.reader.standardsResolver` — `truncateAtSection` returns `{ text, truncated }`; the boolean is all the caller learns
- `review.reviewer.reviewer` — `buildReviewPrompt` re-truncates against `MAX_PROMPT_BYTES` and returns only a string, so its cut cannot be observed
- `entrypoint.cli.governCommand` — logs `standards: <id> (<path>) [truncated]`
- `shared.core.auditSummary` — builds the `### ql-pipeline summary` comment

## Neurons added / changed

| Neuron | Change |
|---|---|
| `standards.reader.standardsResolver` | `truncateAtSection` also returns the dropped `## ` section titles and the dropped character count; `ResolvedStandard` carries them |
| `review.reviewer.reviewer` | `buildReviewPrompt` returns its truncation result alongside the prompt; the in-prompt note names the dropped sections rather than saying "trailing sections" |
| `entrypoint.cli.governCommand` | Logs the named sections for both layers |
| `shared.core.auditSummary` | Adds a **Standards coverage** line to the PR summary comment |

## Design

### 1. `truncateAtSection` reports its cut

```ts
export interface TruncationResult {
  readonly text: string;
  readonly truncated: boolean;
  /** Titles of the `## ` sections removed, in document order. */
  readonly droppedSections: readonly string[];
  readonly droppedChars: number;
}
```

The section scan runs over the removed tail only, so cost is proportional to
what was cut. Titles are recorded verbatim minus the leading `## `.

A document with no `## ` headings that still overflows reports
`droppedSections: []` with a non-zero `droppedChars` — the caller can tell
"cut, and here is where" from "cut, and the document has no sections to name".

### 2. `buildReviewPrompt` stops being silent

Returns `{ prompt, standardsTruncation }` instead of a bare string. This is a
breaking signature change to an exported symbol; `runReview` and its tests are
the only callers.

The existing in-prompt note grows from

> Trailing sections are missing. Do not treat their absence as permission.

to the same sentence followed by the dropped titles. The reviewer is then able
to say "this area was not in my standards" rather than silently not knowing.
`prompts/reviewer.md` is **not** touched — the note is built in `src/`, and the
template only supplies `{{STANDARDS}}`. No R4 path is involved.

### 3. What the log says

As shipped:

```
standards: review.standards (workflow/review/pr-bugfix/checklist.md)
standards: frontend.standards (workflow/review/pr-bugfix/frontend.md)
  [per-area cap] dropped 52112 chars, 28 sections: 04 — Routing & Lazy Loading, 05 — Guards, ... (+18 more)
prompt: standards cut further to fit the prompt ceiling, dropped 18344 chars, 6 sections: 01 — Components, ...
```

Long lists are elided after ten titles with a `(+N more)` count; the full list
goes to the gate report artefact, which has no line-length pressure.

### 4. What the PR summary says

Directly above the finding count, because it is what makes that count
readable. As shipped:

```
**Standards coverage:**
- frontend.standards — 34 of 64 sections; 30 dropped (52112 chars) by the per-area cap
- the prompt ceiling cut a further 6 sections (18344 chars)
```

A percentage was dropped from the planned wording: `34 of 64` already carries
it, and the second line has no total to take a percentage of.

When the diff crowds the standards out completely the second line becomes
**no engineering standards were sent at all**, which is the case most worth
seeing. Omitted entirely when nothing was cut, so the common case stays quiet.

## In scope

- The four neurons above, with unit tests
- `docs/SPECIFICATION.md` §Engineering standards: document that truncation is
  reported and where (R6.0 — the spec may not promise what the code lacks)
- `README.md` if it describes standards loading
- Rebuilt `dist/` (committed, per task 011)

## Out of scope

- **Splitting `frontend.md` into a folder + multi-pass review.** That is the
  actual fix for the recocicla case and is a separate task. It needs numbers
  this task produces: how many sections are really being dropped, and whether
  the per-area cap or the prompt ceiling is doing it. Sizing the split before
  measuring would be guesswork.
- Changing either budget. This task reports; it does not re-tune.
- `rules/*`, `prompts/*`, `pipeline.config.yml`, `.github/workflows/*` — R4.

## Exit criteria

1. Both truncation layers emit a log line naming the dropped sections; neither
   can cut silently.
2. The in-prompt note lists the dropped section titles.
3. The PR summary comment carries a standards-coverage line whenever anything
   was cut, and nothing when it was not.
4. Unit tests cover: no truncation; per-area truncation; prompt-ceiling
   truncation; both at once; a document with no `## ` sections; and the
   elision threshold.
5. `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test` green.
6. `dist/` rebuilt and committed.
7. A recocicla PR run shows the real numbers — which become task 018's input.
