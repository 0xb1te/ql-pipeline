import type { PipelineDecision } from '../verdict/verdict.js';
import type { Area, GateOutcome } from './types.js';
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
}
/**
 * Renders one audit-trail PR comment per pipeline run. Per plan.md §6
 * ("every verdict, complaint, and fix attempt is persisted as PR
 * comments/check outputs — the full decision trail is reconstructible from
 * the PR alone"), this is what makes that true in practice.
 */
export declare function formatAuditSummary(input: AuditSummaryInput): string;
