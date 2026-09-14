// @neuron review.reviewer.reviewPasses
import { formatStandard, type ResolvedStandard } from '../standards/standards-resolver.js';
import type { Finding } from '../shared/types.js';

/**
 * Splits the loaded standards across as few review passes as will carry them
 * whole.
 *
 * Task 017 measured what the single-pass design actually delivered: 48% of
 * `frontend.md` reached the reviewer, and the half it lost was the engineering
 * half - Services, Guards, State Management, Hooks, Auth/Security, Error
 * Handling. A verdict formed against half a checklist is not a weaker verdict,
 * it is an unreadable one: `Findings: 0` cannot be distinguished from "the rule
 * that would have caught it was never in the prompt".
 *
 * The planner packs by budget rather than one-pass-per-document on purpose.
 * A PR touching two areas that both fit today runs ONE pass, exactly as it
 * always has - paying for a second agent call there would buy nothing. Passes
 * are added only when the alternative is dropping text.
 */
export interface ReviewPass {
  readonly standards: readonly ResolvedStandard[];
}

/** Bytes this document costs the prompt, rendered exactly as it will appear. */
// @signal standardCost
export function standardCost(standard: ResolvedStandard): number {
  // `formatStandardsForPrompt` joins with a blank line; charge it here so a
  // plan that fills the budget to the brim still fits once joined.
  return Buffer.byteLength(formatStandard(standard), 'utf8') + 2;
}

/**
 * Documents with no area - the shared `checklist.md` - ride in every pass.
 * They are small by design, and a pass judged without the review checklist
 * would be judged against a different standard than its siblings.
 */
function partition(standards: readonly ResolvedStandard[]): {
  shared: ResolvedStandard[];
  perArea: ResolvedStandard[];
} {
  const shared: ResolvedStandard[] = [];
  const perArea: ResolvedStandard[] = [];
  for (const standard of standards) {
    (standard.area === null ? shared : perArea).push(standard);
  }
  return { shared, perArea };
}

// @signal planReviewPasses
export function planReviewPasses(standards: readonly ResolvedStandard[], budgetBytes: number): ReviewPass[] {
  if (standards.length === 0) {
    return [{ standards: [] }];
  }

  const { shared, perArea } = partition(standards);
  if (perArea.length === 0) {
    return [{ standards: shared }];
  }

  const sharedCost = shared.reduce((sum, standard) => sum + standardCost(standard), 0);
  const perPassBudget = budgetBytes - sharedCost;

  const passes: ResolvedStandard[][] = [];
  let current: ResolvedStandard[] = [];
  let spent = 0;

  for (const standard of perArea) {
    const cost = standardCost(standard);
    // A document larger than a whole pass cannot be helped by planning - it
    // goes alone and `truncateAtSection` reports what it loses. That report is
    // the signal that the document needs splitting further upstream, which is
    // exactly how this task's own numbers were obtained.
    if (current.length > 0 && spent + cost > perPassBudget) {
      passes.push(current);
      current = [];
      spent = 0;
    }
    current.push(standard);
    spent += cost;
  }
  if (current.length > 0) {
    passes.push(current);
  }

  return passes.map((group) => ({ standards: [...shared, ...group] }));
}

/**
 * Collapses findings gathered across passes.
 *
 * The same defect can legitimately surface in two passes - a layering mistake
 * is visible from the architecture slice and from the quality slice - and
 * reporting it twice is noise. The key includes the rule id on purpose: two
 * different rules broken on one line are two findings, and a key of
 * `file:line` alone would silently swallow the second.
 */
// @signal dedupeFindings
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const merged: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.rule}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}
