import type { Finding } from '../shared/types.js';
export interface VerdictInput {
    /**
     * Union of every finding to weigh, regardless of where it came from —
     * a failed gate and an AI review finding are both just findings by the
     * time they reach this function (plan.md §4.3: "a build break is just
     * another fixable finding").
     */
    readonly findings: readonly Finding[];
    readonly attemptsSoFar: number;
    readonly maxFixAttempts: number;
}
export type PipelineDecision = {
    readonly kind: 'MERGE';
    readonly advisoryFindings: readonly Finding[];
} | {
    readonly kind: 'FIX';
    readonly findings: readonly Finding[];
} | {
    readonly kind: 'BLOCK';
    readonly reason: string;
    readonly findings: readonly Finding[];
};
/**
 * Pure decision function: MERGE, FIX, or BLOCK. `should`-severity findings
 * never factor into the decision — they ride along on MERGE as advisory
 * comments (plan.md §4.5).
 */
export declare function decidePipelineOutcome(input: VerdictInput): PipelineDecision;
