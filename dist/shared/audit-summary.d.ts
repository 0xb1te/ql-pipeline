import type { PipelineDecision } from '../verdict/verdict.js';
import { type Area, type GateOutcome } from './types.js';
/** What survived of one standards document, for the coverage line. */
export interface StandardsCoverage {
    readonly id: string;
    readonly keptSections: number;
    readonly droppedSections: number;
    readonly droppedChars: number;
}
/** What the whole-prompt ceiling cut, on top of any per-area cap. */
export interface PromptCoverage {
    readonly droppedSections: number;
    readonly droppedChars: number;
    /** True when the diff filled the budget and no standards fit at all. */
    readonly omitted: boolean;
}
export interface AuditSummaryInput {
    readonly areas: readonly Area[];
    readonly gateOutcomes: readonly GateOutcome[];
    readonly findingCount: number;
    readonly decision: PipelineDecision;
    readonly attemptNumber: number;
    readonly maxFixAttempts: number;
    readonly targetBranch: string;
    /** False when the AI review was skipped (gate failure, or not a required check). */
    readonly reviewRan: boolean;
    /** Per-document coverage; only documents that lost something are listed. */
    readonly standardsCoverage?: readonly StandardsCoverage[];
    /** Present only when the prompt ceiling cut the standards further. */
    readonly promptCoverage?: PromptCoverage;
    /**
     * The Actions run this summary is posted from, so the fix attempt a FIX verdict announces can
     * be watched while it runs. Null outside Actions, where there is no run to point at.
     */
    readonly runUrl?: string | null;
}
/**
 * Renders one audit-trail PR comment per pipeline run. Per plan.md §6
 * ("every verdict, complaint, and fix attempt is persisted as PR
 * comments/check outputs — the full decision trail is reconstructible from
 * the PR alone"), this is what makes that true in practice.
 */
export declare function formatAuditSummary(input: AuditSummaryInput): string;
