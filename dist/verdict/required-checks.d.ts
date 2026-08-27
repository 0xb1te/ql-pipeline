import type { Finding, GateOutcome, RequiredCheck } from '../shared/types.js';
/**
 * Whether the AI review stage runs at all. When `ai-review` isn't a
 * required check, the review is skipped outright rather than run and
 * ignored — a review whose findings can't block is pure cost.
 */
export declare function isReviewRequired(requiredChecks: readonly RequiredCheck[]): boolean;
/**
 * Turns failed gates into findings, so a build break flows through exactly
 * the same verdict path as a review finding (plan.md §4.3). A gate whose
 * stage isn't in `merge.required_checks` still runs and still reports, but
 * its failures are advisory (`should`) instead of blocking — that's the
 * whole point of making the stage optional.
 */
export declare function gateFindings(outcomes: readonly GateOutcome[], requiredChecks: readonly RequiredCheck[]): Finding[];
