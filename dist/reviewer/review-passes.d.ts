import { type ResolvedStandard } from '../standards/standards-resolver.js';
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
export declare function standardCost(standard: ResolvedStandard): number;
export declare function planReviewPasses(standards: readonly ResolvedStandard[], budgetBytes: number): ReviewPass[];
/**
 * Collapses findings gathered across passes.
 *
 * The same defect can legitimately surface in two passes - a layering mistake
 * is visible from the architecture slice and from the quality slice - and
 * reporting it twice is noise. The key includes the rule id on purpose: two
 * different rules broken on one line are two findings, and a key of
 * `file:line` alone would silently swallow the second.
 */
export declare function dedupeFindings(passes: readonly (readonly Finding[])[]): Finding[];
