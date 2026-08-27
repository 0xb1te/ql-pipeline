import { type CommandExecutor } from '../shared/exec.js';
import type { Area, Finding, GateOutcome } from '../shared/types.js';
import { type CursorAgentRunner } from './cursor-runner.js';
export interface ReviewContext {
    readonly areas: readonly Area[];
    /** Every reference id the reviewer may cite: rule files and standards docs. */
    readonly ruleFiles: readonly string[];
    readonly rulesText: string;
    /** House engineering standards for the matched areas (may be empty). */
    readonly standardsText: string;
    readonly gateOutcomes: readonly GateOutcome[];
    readonly prDescription: string;
    readonly diff: string;
}
/** Substitutes the placeholders documented in prompts/reviewer.md. */
export declare function buildReviewPrompt(template: string, context: ReviewContext): string;
export interface ReviewOutcome {
    readonly findings: readonly Finding[];
    readonly discarded: readonly {
        readonly finding: Finding;
        readonly reason: string;
    }[];
}
export type ReviewResult = {
    readonly ok: true;
    readonly outcome: ReviewOutcome;
} | {
    readonly ok: false;
    readonly reason: string;
};
export interface RunReviewOptions {
    readonly cwd: string;
    readonly agentRunner?: CursorAgentRunner;
    readonly commandExecutor?: CommandExecutor;
}
/**
 * Runs the AI reviewer against a PR: builds the prompt, invokes cursor-agent
 * in read-only (`ask`) mode, verifies the checkout wasn't mutated despite
 * that, parses the strict JSON verdict (retrying the invocation once if
 * parsing fails — real responses observed in testing sometimes wrap the
 * JSON in conversational text; a second attempt is worth it before giving
 * up), and applies the grounding requirement to the resulting findings.
 */
export declare function runReview(context: ReviewContext, promptTemplate: string, options: RunReviewOptions): Promise<ReviewResult>;
