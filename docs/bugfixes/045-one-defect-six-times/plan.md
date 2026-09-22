# 045 — Plan

## Confirmed Root Cause

`src/reviewer/review-passes.ts:103`, pre-fix:

```ts
const key = `${finding.file}:${finding.line}:${finding.rule}`;
```

and the caller, `src/cli/govern-command.ts:560-613`:

```ts
const reviewed: Finding[] = [];
for (...) {
  reviewed.push(...reviewResult.outcome.findings);   // :599  every pass flattened into one array
}
findings = [...findingsFromGates, ...dedupeFindings(reviewed)];   // :613
```

Two facts together produce the defect:

1. **The rule is in the key.** Passes see different standards slices and attribute the same observed defect to different rules, so their keys never collide.
2. **The pass boundary is destroyed before dedupe.** `:599` flattens, so even a dedupe that wanted to reason about passes could not.

Evidence: ql-desktop #103, one defect → 6 findings under 6 rule ids, then 4 more on the second run.

### Is the invariant wrong, or is the code failing it?

Neither, exactly — the invariant was **underspecified**. `reviewPasses.yml`'s `owns` states both halves correctly:

> The same defect can legitimately surface in two passes … but two different rules broken on one line are two findings

Those are two different situations and one flat key cannot serve both. The neuron chose to protect the second. The missing idea is that the passes themselves distinguish them.

### Provenance read before declaring the cause

`docs/017-sliced-review-passes/plan.md` — the only provenance on the neuron, and the change that introduced passes and dedupe together. It is the source of both halves of the `owns` bullet. Nothing in it anticipated that one pass's slice determines which rule gets cited, which is what makes the cross-pass duplicate invisible to a rule-bearing key.

## The Fix

`dedupeFindings(passes: readonly (readonly Finding[])[])`.

- Across passes: a spot already anchored by an **earlier** pass is dropped, keyed `file:line`, whatever rule it cites.
- Within one pass: keyed `file:line:rule`, so a pass naming two rules on one line still reports two findings.
- The anchor set is filled **only between passes**, never as each finding is kept. Filling it eagerly would make a pass swallow its own second finding on a line — precisely the failure the rule was in the key to prevent.

Caller keeps `reviewedByPass: Finding[][]` instead of flattening.

No merging of rule ids into a combined finding. That was considered and rejected: it changes what a `Finding` means, and the first pass's rule is a truthful attribution of a real defect. Dropping the restatements loses nothing a reader needs.

## Neurons

**Read:** `review.reviewer.reviewPasses`, `entrypoint.cli.governCommand`, `verdict.decision.verdict`, `merge.merger.merger`, `fix.fixer.fixer`.

**Changing:** `review.reviewer.reviewPasses` — the `owns` bullet rewritten to name the pass boundary as what resolves the tension, plus a second bullet pinning *when* the anchor set is filled; `dedupeFindings` intent restated with the new shape; provenance gains this folder.

No signal added, renamed or removed — `dedupeFindings` changes shape, not identity, so no anchor moves (**KH-10** N/A).

## Regression Test Plan

Every existing case is preserved with its intent intact, re-expressed as one pass or two:

| Existing case | Becomes |
|---|---|
| `reports a defect once when two passes both see it` | two passes — unchanged meaning |
| `keeps two different rules broken on the same line` | **one** pass, renamed `…by one pass` |
| `keeps the same rule broken on different lines` | asserted for both one pass and two |
| `keeps the same rule broken in different files` | asserted for both one pass and two |
| `preserves the first occurrence and its order` | one pass — unchanged |
| `passes an empty list through` | `[]` and `[[]]` |

New:

1. **`collapses one defect that every pass attributed to a different rule`** — six passes, one `file:line`, the six real rule ids from #103 → one finding, and it is the first pass's.
2. **`drops a second pass reporting a line the first pass already anchored`** — the same two rules as the preserved test, split across two passes → one finding. This is the pair that proves the pass boundary is doing the work.
3. **`drops a pass that repeated itself`** — within-pass exact repeat still collapses.

Red proven by reinstating pre-fix semantics under the new signature (flatten + `file:line:rule`): the two cross-pass cases fail, **and all 16 preserved cases still pass** — which is the evidence that no existing assertion was weakened to make room for the fix. The file was then restored and confirmed byte-identical.

## Explicitly Out Of Scope

- **Why six passes cite six rules for one defect.** That is the reviewer prompt's behaviour, not dedupe's. Worth asking separately whether a pass should be told to attribute to the most specific rule; this task makes the symptom harmless either way.
- **Merging duplicate findings into one that lists every rule.** Rejected above.
- **MCP surface.** No tool, schema or return shape changes, so the `MCP Cases` sheet is present and empty.

## Version

`0.3.2 → 0.3.3` (PATCH). `dedupeFindings` is not part of the published API — `package.json` `bin` exposes `dist/main.js` and `dist/mcp/server.js`, and no consumer imports this module. Its signature change is internal, and the observable effect is a shorter findings list on a multi-pass review.
