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
/**
 * Ceiling for the assembled prompt, in bytes.
 *
 * This is a cost and context budget, not an OS limit: the prompt goes to
 * `cursor-agent` on stdin, which has no size ceiling of its own. It was
 * originally sized against MAX_ARG_STRLEN, back when the prompt was a single
 * argv element and a PR touching two areas crashed with `spawn E2BIG`.
 *
 * It stays because `standards.max_chars_per_area` still cannot express it:
 * that is a *per-area* cap, so a PR touching two areas carries twice it, and
 * three areas three times. Whatever the right total is, only a total can say
 * it. Raise this when the standards are worth more than the tokens.
 */
export declare const MAX_PROMPT_BYTES = 120000;
/**
 * Substitutes the placeholders documented in prompts/reviewer.md, trimming the
 * standards if the result would be too large to spawn.
 *
 * The standards are what gets cut, because they are the one part that is both
 * large and safely divisible — they are already organised into sections and
 * already have a truncation routine that cuts on a section boundary. The diff
 * and the rules are not: half a diff is a misleading review, and a rule set
 * missing its tail silently stops being the thing the PR is judged against.
 */
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
    readonly model?: string;
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
